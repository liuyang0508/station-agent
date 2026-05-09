# Douyin Topic Detection Capability — Design Spec

**Date**: 2026-05-09
**Status**: Draft

## Overview

A capability that detects how many videos from a given list of Douyin accounts are related to a specified topic. The detection uses a combination of keyword matching, topic tag matching, and AI semantic judgment.

## Data Source

- **Method**: Douyin web interface via Playwright
- **URL Pattern**: `https://www.douyin.com/aweme/v1/web/aweme/post/`

## Input Methods

1. **File upload**: `.txt` or `.csv` with one Douyin profile URL or UID per line
2. **UI input**: Manual input in Station Agent interface
3. **API parameter**: Via API call `POST /api/douyin/detect`

## Match Logic

Combination of three approaches:
1. **Keyword matching**: Match against video title/description
2. **Topic tag matching**: Match against video hashtags
3. **AI semantic judgment**: Use model to determine relevance (optional, configurable)

## Output Forms

1. **Terminal output**: Print statistics
2. **JSON file**: Structured result file with account, topic, match count, etc.
3. **UI display**: Report displayed in Station Agent interface

## Scale

- Target: 100+ accounts, frequent queries
- Requires queue management and anti-ban mechanisms

## Architecture

```
src/lib/douyin/
├── crawler.mjs       # Playwright-based crawler
├── queue.mjs         # Account queue management
├── matcher.mjs       # Topic matcher (keyword + tag + AI)
├── rateLimiter.mjs   # Rate control + ban detection
└── store.mjs         # Result persistence
```

## Key Components

### 1. crawler.mjs

- Uses Playwright to browse Douyin anonymously
- Fetches user's video list via `/aweme/v1/web/aweme/post/`
- Handles pagination (30 videos per page)
- Returns raw video data (title, description, tags, publish time)

### 2. queue.mjs

- Manages account queue for batch processing
- Supports concurrent processing (configurable parallelism)
- Tracks account status: pending, processing, completed, failed, banned

### 3. matcher.mjs

- `matchKeyword(text, keywords)`: Returns true if any keyword found
- `matchTag(tags, targetTags)`: Returns true if any target tag found
- `matchAI(videoData, topic)`: Calls model to judge relevance
- Combines all three with configurable weights/thresholds

### 4. rateLimiter.mjs

- Random delay between requests (3-8 seconds, jitter)
- Tracks request count per account
- Detects ban signals (CAPTCHA, 403, abnormal responses)
- Auto-pause and retry on ban detection
- Per-account cookie pool rotation

### 5. store.mjs

- Uses SQLite (via existing `sqliteStore.mjs`)
- Schema:
  - `douyin_detection`: id, account_id, account_url, topic, total_videos, matched_videos, created_at
  - `douyin_detection_detail`: id, detection_id, video_id, video_title, matched_reason, matched_at

## Execution Modes

### On-demand Query

1. User provides account list + topic
2. Queue manager distributes accounts to workers
3. Each worker fetches videos and runs matcher
4. Results accumulated and returned
5. JSON file generated, UI updated

### Scheduled Task

1. Configured via `routines.mjs` (e.g., daily at 2am)
2. Reads account list from configured source
3. Same pipeline as on-demand
4. Results stored for comparison over time

## API Endpoint

```
POST /api/douyin/detect
Body: {
  accounts: string[],       // list of Douyin profile URLs or UIDs
  topic: string,            // detection topic
  options: {
    useAI: boolean,         // enable AI semantic matching
    outputFormats: string[] // ["terminal", "json", "ui"]
  }
}
Response: {
  detectionId: string,
  status: "queued" | "processing" | "completed" | "failed",
  progress: number // 0-100
}
```

```
GET /api/douyin/detect/:id
Response: {
  id: string,
  status: string,
  results: {
    account: string,
    totalVideos: number,
    matchedVideos: number,
    matchedDetails: [...]
  }[]
}
```

## Error Handling

- **Network error**: Retry 3 times with exponential backoff
- **Ban detected**: Pause account for 30min, then retry
- **Rate limit**: Enforce global rate limit, queue overflow pauses intake
- **Invalid account**: Mark as failed, continue with others

## Configuration

```js
// config/douyin.json
{
  "crawler": {
    "headless": true,
    "timeout": 30000,
    "maxRetries": 3
  },
  "rateLimit": {
    "minDelay": 3000,
    "maxDelay": 8000,
    "maxConcurrent": 5
  },
  "matcher": {
    "keywords": [],
    "targetTags": []
  }
}
```

## File Structure

```
src/lib/douyin/
├── index.mjs              # Main export
├── crawler.mjs
├── queue.mjs
├── matcher.mjs
├── rateLimiter.mjs
├── store.mjs
└── config.mjs              # Configuration loader
```