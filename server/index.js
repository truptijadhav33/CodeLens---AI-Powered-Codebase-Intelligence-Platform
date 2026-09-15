require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const mongoSanitize = require("express-mongo-sanitize");
const authRoutes = require("./routes/auth");
const repoRoutes = require("./routes/repos");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());
// Strip $ and . from incoming keys before they reach any query, blocking NoSQL
// operator injection through req.query / req.body / req.params. The library's
// built-in middleware reassigns req.query, which is read-only in Express 5, so
// use its sanitize() directly and mutate in place — identical effect.
app.use((req, _res, next) => {
  mongoSanitize.sanitize(req.body);
  mongoSanitize.sanitize(req.params);
  mongoSanitize.sanitize(req.query);
  next();
});
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/api/repos", repoRoutes);

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB connection error:", err.message));
} else {
  console.warn("MONGODB_URI not set — skipping database connection");
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});