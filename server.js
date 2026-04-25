import express from 'express';
import db from './db/index.js';
import 'dotenv/config';
import { jobsTable } from './db/schema.js';


const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

app.get('/', async (req, res) => {
    return res.json({ message: 'Hello, World!' });
});

app.post('/job', async (req, res) => {
    const { image, cmd } = req.body;
    try {
        const [job] = await db.insert(jobsTable).values({ image, cmd }).returning({
            id: jobsTable.id,});
        return res.status(201).json({ jobId: job.id });
    } catch (error) {
        console.error('Error creating job:', error);
        return res.status(500).json({ error: 'Failed to create job' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});