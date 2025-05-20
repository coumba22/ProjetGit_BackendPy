 # Modèles de données (SQLAlchemy)
 
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(100), unique=True, nullable=False)

class Project(db.Model):
    __tablename__ = 'projects'
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    repo_url = Column(String(200), nullable=False)
    created_at = Column(DateTime)

class Contribution(db.Model):
    __tablename__ = 'contributions'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
    project_id = Column(Integer, ForeignKey('projects.id'))
    commits = Column(Integer, default=0)
    merges = Column(Integer, default=0)

    user = relationship("User")
    project = relationship("Project")
