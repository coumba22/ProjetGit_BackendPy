from flask import Blueprint, request, render_template, redirect, url_for
from app.gitstats_utils import generer_gitstats, cloner_ou_update_repo

gitstats_api = Blueprint("gitstats_api", __name__)

@gitstats_api.route("/dashboard/gitstats", methods=["POST"])
def lancer_gitstats():
    repo_url = request.form.get("repo_url")
    if not repo_url:
        return "URL du dépôt requise", 400

    try:
        # Cloner ou update le repo
        repo_path = cloner_ou_update_repo(repo_url)
    except Exception as e:
        return f"Erreur git: {e}", 500

    output_path = "static/gitstats"
    result = generer_gitstats(repo_path, output_path)

    if "error" in result:
        return f"Erreur : {result['error']}", 500

    return redirect(url_for("gitstats_api.afficher_gitstats"))


@gitstats_api.route("/dashboard/gitstats")
def afficher_gitstats():
    return render_template("gitstats_view.html")
