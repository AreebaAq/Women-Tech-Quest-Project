// Loads .env for command-line scripts (Next.js does this itself for the web app).
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: rely on variables already set in the environment.
}
