// Runs before each test file: isolated in-memory database and a known ingest key
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.INGEST_API_KEY = "test-ingest-key";
