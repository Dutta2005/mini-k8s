import { Queue } from 'bullmq';

// schedulers
export const jobDispatchScheduler = new Queue('job-dispatcher');
export const jobCriSchedular = new Queue('job-cri');
export const jobWatcherSchedular = new Queue('job-watcher');