 # Configuration globale
 
import os
from dotenv import load_dotenv

# Charger les variables d'environnement depuis le fichier .env
load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY")
    SQLALCHEMY_DATABASE_URI = os.getenv("SQLALCHEMY_DATABASE_URI")
    GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"




