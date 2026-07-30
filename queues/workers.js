import { Worker } from 'bullmq';
import db from '../db/index.js';
import { jobsTable, jobStatusEnumValues } from '../db/schema.js';
import { eq, inArray, sql } from 'drizzle-orm';
import Docker from 'dockerode';

const docker = process.platform === 'win32'
    ? new Docker({ socketPath: '//./pipe/docker_engine' })
    : new Docker({ socketPath: '/var/run/docker.sock' });

function pullImage(image) {
    return new Promise(async (resolve, reject) => {
        try {
            const stream = await docker.pull(image);
            stream.modem.followProgress(stream, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        } catch (error) {
            reject(error);
        }
    });
}

export const jobDispatchWorker = new Worker('job-dispatcher', async () => {
    console.log('[JobDispatcher]: Checking for SUBMITTED jobs...');
    await db.transaction(async (tx) => {
        const statement = sql`
            SELECT 
                id
            FROM ${jobsTable}
            WHERE 
                ${jobsTable.status} = ${jobStatusEnumValues[0]}
            ORDER BY ${jobsTable.createdAt} ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 5
        `;

        const result = await tx.execute(statement);
        const jobIds = result.rows.map(row => row.id);

        console.log(`[JobDispatcher]: Found ${jobIds.length} SUBMITTED jobs: ${jobIds.join(', ')}`);

        // TODO: check if compute is available 

        if (jobIds.length > 0) {
            console.log(`[JobDispatcher]: Moving ${jobIds.length} jobs to Runnable states...`);

            await tx.update(jobsTable)
                .set({ status: jobStatusEnumValues[1] })
                .where(inArray(jobsTable.id, jobIds));
        }


    }, {
        accessMode: 'read write', isolationLevel: 'read committed'
    });
}, {
    connection: {
        host: '127.0.0.1',
        port: 6379,
    },
});

export const jobCriWorker = new Worker('job-cri', async () => {
    console.log('[JobCRIWorker]: Checking for RUNNABLE jobs...');
    await db.transaction(async (tx) => {
        const statement = sql`
            SELECT 
                id
            FROM ${jobsTable}
            WHERE 
                ${jobsTable.status} = ${jobStatusEnumValues[1]}
            ORDER BY ${jobsTable.createdAt} ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `;

        const result = await tx.execute(statement);
        const jobIds = result.rows.map(row => row.id);

        console.log(`[JobCRIWorker]: Found ${jobIds.length} RUNNABLE jobs: ${jobIds.join(', ')}`);

        for (const jobId of jobIds) {
            const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId));
            console.log(`[JobCRIWorker]: Processing job ${job.id} with image ${job.image} and cmd ${job.cmd}...`);
            const checkImageResult = await docker.listImages({
                filters: {
                    reference: [`${job.image}:latest`],
                },
            });
            if (!checkImageResult || checkImageResult.length <= 0) {
                console.log(`[JobCRIWorker]: Pulling image ${job.image}:latest for job ${job.id}...`);
                await pullImage(`${job.image}:latest`);
            }

            const containerConfig = {
                Image: `${job.image}:latest`,
                Tty: false,
                HostConfig: {
                    AutoRemove: true,
                },
            };

            if (job.cmd && job.cmd.trim().length > 0) {
                containerConfig.Cmd = job.cmd.trim().split(/\s+/);
            }

            const container = await docker.createContainer(containerConfig);

            await container.start();
            console.log(`[JobCRIWorker]: Started container ${container.id} for job ${job.id}...`);
            await tx.update(jobsTable).set({ status: 'RUNNING', containerId: container.id })
                .where(eq(jobsTable.id, jobId));
        }
    }, {
        accessMode: 'read write', isolationLevel: 'read committed'
    });
}, {
    connection: {
        host: '127.0.0.1',
        port: 6379,
    },
});

export const jobWatch = new Worker('job-watcher', async () => {
    console.log('[JobWatcher]: Checking for RUNNING jobs...');
    await db.transaction(async (tx) => {
        const statement = sql`
            SELECT 
                id
            FROM ${jobsTable}
            WHERE 
                ${jobsTable.status} = ${jobStatusEnumValues[2]}
            ORDER BY ${jobsTable.createdAt} ASC
            FOR UPDATE
            LIMIT 1
        `;

        const result = await tx.execute(statement);
        const jobIds = result.rows.map(row => row.id);

        for (const jobId of jobIds) {
            const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));

            if (job.containerId) {
                const container = docker.getContainer(job.containerId);
                const containerInfo = await container.inspect();
                const state = containerInfo.State.Status;
                if (state === 'running') {
                    console.log(`[JobWatcher]: Container ${job.containerId} for job ${job.id} is still running...`);
                } else {
                    console.log(`[JobWatcher]: Container ${job.containerId} for job ${job.id} is not running anymore...`);
                    await tx.update(jobsTable).set({ status: state === 'exited' ? 'SUCCEEDED' : 'FAILED' }).where(eq(jobsTable.id, jobId));
                    await container.remove();
                }
            }
        }

    }, { accessMode: 'read write', isolationLevel: 'read committed' });
}, {
    connection: {
        host: '127.0.0.1',
        port: 6379,
    },
});

jobDispatchWorker.on('failed', (job, error) => {
    console.error(`[JobDispatcher]: Worker job ${job?.id ?? 'unknown'} failed`, error);
});

jobCriWorker.on('failed', (job, error) => {
    console.error(`[JobCRIWorker]: Worker job ${job?.id ?? 'unknown'} failed`, error);
});

jobWatch.on('failed', (job, error) => {
    console.error(`[JobWatcher]: Worker job ${job?.id ?? 'unknown'} failed`, error);
});