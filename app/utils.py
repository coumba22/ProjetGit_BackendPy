## Fonction lire_repos()

import json

def lire_repos():
    try:
        with open("data/repos.json", "r") as f:
            data = json.load(f)

        # Vérifie si la clé "repos" est présente
        if "repos" in data:
            return data["repos"]
        else:
            print("Le fichier JSON ne contient pas de clé 'repos'.")
            return []
    except Exception as e:
        print(f"Erreur lors de la lecture du fichier JSON : {e}")
        return []
