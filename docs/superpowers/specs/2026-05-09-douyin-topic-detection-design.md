# Douyin Topic Detection Capability — Design Spec

**Date**: 2026-05-09
**Status**: Approved

## Overview

A capability that detects how many videos from a given list of Douyin accounts are related to a specified topic. The detection uses a combination of keyword matching, topic tag matching, and AI semantic judgment.

## Data Source

- **Primary**: Douyin search API (`/aweme/v1/web/search/item/`)
- Uses topic keyword to search related videos, then filters by author account list

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
- Optimized via search API (O(1) requests instead of O(accounts × pages))

## Architecture

```
src/lib/douyin/
├── index.mjs              # Main export
├── searcher.mjs           # Search API caller (keyword → videos)
├── accountMatcher.mjs     # Filter videos by author account list
├── matcher.mjs            # Topic matcher (keyword + tag + AI)
├── cache.mjs              # Account list cache (UID ↔ profile)
└── store.mjs              # Result persistence
```

## Key Components

### 1. searcher.mjs

- Calls `/aweme/v1/web/search/item/` with topic keyword
- Handles pagination (16 videos per page, configurable)
- Returns raw video data (id, title, description, author, hashtags, publish time)
- Handles rate limiting and retry with exponential backoff
- Supports both authenticated (cookie) and anonymous requests

### 2. accountMatcher.mjs

- Maintains in-memory Set of account UIDs/nicknames from input list
- Filters search results: keeps only videos where author is in account list
- Supports both UID and profile URL as input
- Returns matched video list with author info

### 3. matcher.mjs

- `matchKeyword(text, keywords)`: Returns true if any keyword found
- `matchTag(tags, targetTags)`: Returns true if any target tag found
- `matchAI(videoData, topic)`: Calls model to judge relevance
- Combines all three with configurable weights/thresholds

### 4. cache.mjs

- Caches account list for repeated queries
- TTL: 1 hour (configurable)
- Key: account identifier (UID or profile URL)
- Value: normalized account profile

### 5. store.mjs

- Uses SQLite (via existing `sqliteStore.mjs`)
- Schema:
  - `douyin_detection`: id, topic, total_matched, created_at
  - `douyin_detection_detail`: id, detection_id, video_id, video_title, author, matched_reason, matched_at

## Execution Modes

### On-demand Query

1. User provides account list + topic
2. Search API fetches videos matching topic keyword
3. Filter by account list
4. Run matcher on filtered videos
5. Return results, generate JSON, update UI

### Scheduled Task

1. Configured via `routines.mjs`
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
    matchedVideos: number,
    matchedDetails: [...]
  }[]
}
```

## Error Handling

- **Rate limit**: Retry with backoff, max 3 retries
- **No results**: Return empty with 0 count (not error)
- **Invalid account**: Mark as failed, log and continue
- **Network error**: Retry 3 times with exponential backoff

## Configuration

```js
// config/douyin.json
{
  "searcher": {
    "count": 16,           // videos per page
    "maxPages": 10,        // max pages to fetch
    "timeout": 30000,
    "maxRetries": 3
  },
  "matcher": {
    "keywords": [],
    "targetTags": []
  },
  "cache": {
    "ttl": 3600000         // 1 hour in ms
  }
}
```

## File Structure

```
src/lib/douyin/
├── index.mjs              # Main export
├── searcher.mjs
├── accountMatcher.mjs
├── matcher.mjs
├── cache.mjs
└── store.mjs
```