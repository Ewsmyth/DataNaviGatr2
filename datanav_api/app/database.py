from flask_sqlalchemy import SQLAlchemy

"""
SQLAlchemy extension instance.

create_app initializes this object with the Flask app, and model modules import
it to declare tables and relationships.
"""

db = SQLAlchemy()
