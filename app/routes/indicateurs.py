from flask import Blueprint, jsonify, send_file
from github import Github
from app.utils.utils2 import lire_tds
import os
from dotenv import load_dotenv
from app.utils.utils2 import lire_groupes
from fpdf import FPDF
import requests



load_dotenv()

indicateurs_api = Blueprint('indicateurs_api', __name__)
g = Github(os.getenv("GITHUB_TOKEN"))


@indicateurs_api.route('/export/pdf', methods=['GET'])
def export_pdf():
    os.makedirs("static", exist_ok=True)
    data = requests.get("http://127.0.0.1:4000/api/indicateurs").json()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)

    pdf.cell(200, 10, txt="Rapport des scores d'implication", ln=True, align='C')

    for td, auteurs in data.items():
        pdf.ln(10)
        pdf.cell(200, 10, txt=f"== {td} ==", ln=True)
        for auteur, stats in auteurs.items():
            score = stats.get("score", 0)
            pdf.cell(200, 10, txt=f"{auteur} → Score: {score}", ln=True)

    filepath = "static/rapport_scores.pdf"
    pdf.output(filepath)
    return send_file(filepath, as_attachment=True)


@indicateurs_api.route('/indicateurs/groupes', methods=['GET'])
def indicateurs_groupes():
    tds = lire_tds()
    groupes = lire_groupes()
    resultats = {}

    for td, infos in tds.items():
        try:
            repo = g.get_repo(infos["repo"].replace("https://github.com/", ""))
            commits = repo.get_commits()
            deadline = infos["deadline"]

            stats_td = {}
            for commit in commits:
                auteur = commit.author.login if commit.author else "Inconnu"
                if auteur not in stats_td:
                    stats_td[auteur] = {"commits": 0, "after_deadline": 0}
                stats_td[auteur]["commits"] += 1
                if commit.commit.author.date.isoformat() > deadline:
                    stats_td[auteur]["after_deadline"] += 1

            # Score individuel
            for auteur in stats_td:
                c = stats_td[auteur]["commits"]
                late = stats_td[auteur]["after_deadline"]
                stats_td[auteur]["score"] = c - (2 * late)

            # Agréger par groupe
            scores_par_groupe = {}
            for groupe, membres in groupes.items():
                scores = [stats_td[m]["score"] for m in membres if m in stats_td]
                scores_par_groupe[groupe] = round(sum(scores) / len(scores), 2) if scores else 0

            resultats[td] = scores_par_groupe
        except Exception as e:
            resultats[td] = {"error": str(e)}

    return jsonify(resultats)

@indicateurs_api.route('/indicateurs', methods=['GET'])
def indicateurs():
    print(f"Hello")
    tds = lire_tds()
    resultats = {}
    

    for nom_td, infos in tds.items():
        name = infos["repo"].replace("https://github.com/", "")
        resultats[name] = name

    for nom_td, infos in tds.items():
        try:
            repo = g.get_repo(infos["repo"].replace("https://github.com/", ""))
            
            commits = repo.get_commits()
            deadline = infos["deadline"]

            stats_td = {}
            for commit in commits:
                auteur = commit.author.login if commit.author else "Inconnu"
                if auteur not in stats_td:
                    stats_td[auteur] = {"commits": 0, "after_deadline": 0}

                stats_td[auteur]["commits"] += 1

                if commit.commit.author.date.isoformat() > deadline:
                    stats_td[auteur]["after_deadline"] += 1

            # Calcul du score
            for auteur in stats_td:
                c = stats_td[auteur]["commits"]
                late = stats_td[auteur]["after_deadline"]
                stats_td[auteur]["score"] = c - (2 * late)

            resultats[nom_td] = stats_td

        except Exception as e:
            resultats[nom_td] = {"error": str(e)}

    return jsonify(resultats)
