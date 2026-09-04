"""
app.py
------
Flask application entry point for AI SQL Assistant.
"""

import os
import logging
from datetime import datetime
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from dotenv import load_dotenv
from services.sql_generator import generate_sql, explain_sql

# Load environment variables from .env (no-op if the file is absent)
load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_NAME        = "AI SQL Assistant"
MAX_QUERY_LENGTH = int(os.getenv("MAX_QUERY_LENGTH", 1000))

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/", methods=["GET"])
def index():
    """Serve the main HTML page."""
    return render_template("index.html", year=datetime.now().year)


@app.route("/generate", methods=["POST"])
def generate():
    """
    POST /generate
    Body:    { "query": "<natural language query>" }
    Returns: { "sql": "<SQL statement>", "method": "llm|rule-based" }
          or { "error": "<error message>" }
    """
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON."}), 400

        natural_query = data.get("query", "").strip()
        if not natural_query:
            return jsonify({"error": "The 'query' field is required and cannot be empty."}), 400

        if len(natural_query) > MAX_QUERY_LENGTH:
            return jsonify({
                "error": f"Query is too long. Please keep it under {MAX_QUERY_LENGTH} characters."
            }), 400

        result = generate_sql(natural_query)

        if "error" in result:
            return jsonify(result), 422

        logger.info("Generated SQL [%s]: %s", result.get("method"), result.get("sql"))
        return jsonify(result), 200

    except Exception as exc:
        logger.exception("Unexpected error in /generate endpoint.")
        return jsonify({"error": f"Internal server error: {str(exc)}"}), 500


@app.route("/explain", methods=["POST"])
def explain():
    """
    POST /explain
    Body:    { "sql": "<SQL statement>" }
    Returns: { "explanation": "<explanation string>", "method": "llm|rule-based" }
          or { "error": "<error message>" }
    """
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return jsonify({"error": "Request body must be valid JSON."}), 400

        sql = data.get("sql", "").strip()
        if not sql:
            return jsonify({"error": "The 'sql' field is required and cannot be empty."}), 400

        result = explain_sql(sql)

        if "error" in result:
            return jsonify(result), 422

        logger.info("Explained SQL [%s]", result.get("method"))
        return jsonify(result), 200

    except Exception as exc:
        logger.exception("Unexpected error in /explain endpoint.")
        return jsonify({"error": f"Internal server error: {str(exc)}"}), 500


@app.route("/health", methods=["GET"])
def health():
    """Simple health-check endpoint."""
    return jsonify({"status": "ok", "service": APP_NAME}), 200


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug)
