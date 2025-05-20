# Authentification et gestion utilisateurs

from flask import Blueprint, jsonify

auth = Blueprint('auth', __name__)

@auth.route('/login', methods=['POST'])
def login():
    return jsonify({"message": "Authentification réussie"})
