export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorMiddleware(error, req, res, next) {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.message || "Internal server error"
  });
}

export function health(app, serviceName) {
  app.get("/health", (req, res) => {
    res.json({ service: serviceName, status: "ok" });
  });
}

