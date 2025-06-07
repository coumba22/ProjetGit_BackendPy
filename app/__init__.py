from flask import Flask, jsonify
from app.config import Config
from flask_restful import Api, Resource
from app.models import db
from app.routes.auth import auth
from app.routes.github_api import get_commits_for_repos, github_api
from app.routes.stats import stats_api
import os
from app.routes.indicateurs import indicateurs_api
from flask_cors import CORS
from app.routes.gitstats import gitstats_api

from app.routes.stats2 import StatsAPI
from app.routes.audit import AuditAPI
from app.utils.dir_manager import DirManager


def create_app():

    app = Flask(__name__)
    CORS(app)
    app.config.from_object(Config)

    # Charger le token GitHub depuis l'environnement
    #app.config['GITHUB_TOKEN'] = os.getenv("GITHUB_TOKEN")
    if not app.config['GITHUB_TOKEN']:
        raise RuntimeError("Le token GitHub est manquant dans le fichier .env")

    # Initialisation de l'API
    api = Api(app)

    # Initialiser la base de données
    db.init_app(app)

    #api.add_resource(AuthAPI, '/api/auth')
    #api.add_resource(GithubAPI, '/api/github')
    api.add_resource(StatsAPI, '/api/stats')
    api.add_resource(AuditAPI, '/api/audit')
    api.add_resource(DirManager, '/api/clone')
    #api.add_resource(IndicateursAPI, '/api/indicateurs')
    #api.add_resource(GitstatsAPI, '/api/gitstats')
    #api.add_resource(AnalysisAPI, '/api/analyze')

    # Enregistrer les blueprints
    '''app.register_blueprint(auth, url_prefix='/auth')
    app.register_blueprint(github_api, url_prefix='/api')
    app.register_blueprint(stats_api, url_prefix='/api')
    app.register_blueprint(indicateurs_api, url_prefix='/api')
    app.register_blueprint(gitstats_api, url_prefix='/api')'''


    @app.route('/')
    def home():
        return "Bienvenue sur ProjetGit !"

    @app.route('/analyze')
    def analyze_repos():
        try:
            token = app.config['GITHUB_TOKEN']
            get_commits_for_repos(token)
            return jsonify({"message": "Analyse des commits terminée."})
        except Exception as e:
            return jsonify({"error": f"Erreur lors de l'analyse : {str(e)}"}), 500

    return app