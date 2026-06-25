function notFound(_req, res) {
  res.status(404).json({ error: "Not found" });
}

function errorHandler(err, _req, res, _next) {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = err.message || "Internal server error";
  if (process.env.NODE_ENV !== "production") {
    console.error("[API Error]", message);
  }
  res.status(status).json({ error: message });
}

module.exports = { notFound, errorHandler };
