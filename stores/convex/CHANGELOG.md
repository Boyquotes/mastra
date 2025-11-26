# @mastra/convex

## 0.0.2-beta.0

### Patch Changes

- Convex storage and vector adapter improvements: ([#10421](https://github.com/mastra-ai/mastra/pull/10421))
  - Refactored to use typed Convex tables for each Mastra domain (threads, messages, resources, workflows, scorers, vectors)
  - All tables now include `id` field for Mastra record ID and `by_record_id` index for efficient lookups
  - Fixed 32k document limit issues by using batched operations and indexed queries
  - Updated `saveMessages` and `updateMessages` to automatically update thread `updatedAt` timestamps
  - Fixed `listMessages` to properly fetch messages from different threads when using `include`
  - Fixed `saveResource` to preserve `undefined` metadata instead of converting to empty object
  - Rewrote `ConvexAdminClient` to use Convex HTTP API directly with proper admin authentication
  - Added comprehensive documentation for storage and vector adapters
  - Exported pre-built table definitions from `@mastra/convex/server` for easy schema setup

- Updated dependencies [[`c237233`](https://github.com/mastra-ai/mastra/commit/c23723399ccedf7f5744b3f40997b79246bfbe64), [`2500740`](https://github.com/mastra-ai/mastra/commit/2500740ea23da067d6e50ec71c625ab3ce275e64), [`db70a48`](https://github.com/mastra-ai/mastra/commit/db70a48aeeeeb8e5f92007e8ede52c364ce15287), [`5d171ad`](https://github.com/mastra-ai/mastra/commit/5d171ad9ef340387276b77c2bb3e83e83332d729)]:
  - @mastra/core@1.0.0-beta.6

## Unreleased

- Initial release.
