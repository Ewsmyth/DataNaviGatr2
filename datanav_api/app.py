from app import create_app

"""
WSGI/dev-server entry point for the main API container.
create_app lives in datanav_api/app/__init__.py so tests and servers can build
the Flask app from one place.
"""

app = create_app()

if __name__ == "__main__":
    # Local development server; production should run this app through a WSGI server.
    app.run(host="0.0.0.0", port=5001, debug=True)
