import { jobCriSchedular, jobDispatchScheduler, jobWatcherSchedular } from "./queues/queues.js";

async function init() {
    Promise.all([
        jobDispatchScheduler.upsertJobScheduler('job-dispatch-scheduler', {
            every: 2 * 1000,
        }),
        jobCriSchedular.upsertJobScheduler('job-cri-scheduler', {
            every: 5 * 1000,
        }),
        jobWatcherSchedular.upsertJobScheduler('job-watcher-scheduler', {
            every: 10 * 1000,
        }),
    ])
}

init();