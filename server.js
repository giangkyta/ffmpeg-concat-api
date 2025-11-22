const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'FFmpeg Video Concat API on Railway',
    endpoints: {
      concat: 'POST /concat-videos',
      health: 'GET /health'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Concat videos endpoint
app.post('/concat-videos', async (req, res) => {
  const { video_urls } = req.body;
  
  if (!video_urls || !Array.isArray(video_urls) || video_urls.length === 0) {
    return res.status(400).json({ error: 'video_urls array is required' });
  }
  
  const jobId = uuidv4();
  const tempDir = `/tmp/${jobId}`;
  
  console.log(`[${jobId}] Starting concatenation for ${video_urls.length} videos`);
  
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Download videos
    console.log(`[${jobId}] Downloading videos...`);
    const downloadedFiles = [];
    
    for (let i = 0; i < video_urls.length; i++) {
      const tempFile = path.join(tempDir, `video_${i}.mp4`);
      console.log(`[${jobId}] Downloading video ${i + 1}/${video_urls.length}`);
      
      const response = await axios({
        method: 'GET',
        url: video_urls[i],
        responseType: 'stream',
        timeout: 60000
      });
      
      const writer = fs.createWriteStream(tempFile);
      response.data.pipe(writer);
      
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      
      downloadedFiles.push(tempFile);
    }
    
    console.log(`[${jobId}] All videos downloaded, starting concatenation...`);
    
    // Concat videos
    const outputFile = path.join(tempDir, 'output.mp4');
    
    await new Promise((resolve, reject) => {
      let command = ffmpeg();
      
      downloadedFiles.forEach(file => {
        command = command.input(file);
      });
      
      const filterParts = [];
      for (let i = 0; i < downloadedFiles.length; i++) {
        filterParts.push(`[${i}:v][${i}:a]`);
      }
      
      command
        .complexFilter([
          `${filterParts.join('')}concat=n=${downloadedFiles.length}:v=1:a=1[outv][outa]`
        ])
        .outputOptions(['-map', '[outv]', '-map', '[outa]'])
        .output(outputFile)
        .on('progress', (progress) => {
          console.log(`[${jobId}] Processing: ${progress.percent?.toFixed(2)}%`);
        })
        .on('end', () => {
          console.log(`[${jobId}] Concatenation completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${jobId}] FFmpeg error:`, err);
          reject(err);
        })
        .run();
    });
    
    // Send result
    const videoBuffer = fs.readFileSync(outputFile);
    console.log(`[${jobId}] Sending result (${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
    
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename=concatenated.mp4');
    res.send(videoBuffer);
    
  } catch (error) {
    console.error(`[${jobId}] Error:`, error.message);
    
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    res.status(500).json({ 
      error: 'Failed to concatenate videos',
      details: error.message 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 FFmpeg API running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});
