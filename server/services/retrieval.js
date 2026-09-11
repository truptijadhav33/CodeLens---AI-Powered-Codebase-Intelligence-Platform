const Chunk = require("../models/Chunk");
const { embedSingle } = require("./embeddings");

const VECTOR_INDEX_NAME = "vector_index";
const TOP_K = 6;
const NUM_CANDIDATES = 100;

async function retrieveRelevantChunks(repositoryId, question) {
  const tEmbed = Date.now();
  const questionEmbedding = await embedSingle(question, "RETRIEVAL_QUERY");
  const embedMs = Date.now() - tEmbed;

  // Atlas $vectorSearch filter expects an explicit $eq for ObjectId fields
  const pipeline = [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector: questionEmbedding,
        numCandidates: NUM_CANDIDATES,
        limit: TOP_K,
        filter: { repositoryId: { $eq: repositoryId } },
      },
    },
    {
      $project: {
        path: 1,
        content: 1,
        chunkIndex: 1,
        repositoryId: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const tSearch = Date.now();
  const results = await Chunk.aggregate(pipeline);
  const vectorMs = Date.now() - tSearch;
  return { chunks: results, embedMs, vectorMs };
}

module.exports = { retrieveRelevantChunks, VECTOR_INDEX_NAME, TOP_K };