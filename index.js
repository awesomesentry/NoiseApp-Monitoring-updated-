// Vercel serverless entry (project root — NOT inside /api)
// Keeping this at root avoids Vercel's /api/* file-based routing conflicts.
module.exports = require("./server/server.js");
