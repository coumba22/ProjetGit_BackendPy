from flask import Blueprint, request, render_template, redirect, url_for
from app.gitstats_utils import generer_gitstats

gitstats_api = Blueprint("gitstats_api", __name__)

@gitstats_api.route("/dashboard/gitstats", methods=["POST"])
def lancer_gitstats():
    repo_path = request.form.get("repo_path")

    if not repo_path:
        return "Chemin du dépôt requis", 400

    output_path = "static/gitstats"
    result = generer_gitstats(repo_path, output_path)

    if "error" in result:
        return f"Erreur : {result['error']}", 500

    return redirect(url_for("gitstats_api.afficher_gitstats"))


@gitstats_api.route("/dashboard/gitstats")
def afficher_gitstats():
    return render_template("gitstats_view.html")
