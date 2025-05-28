import subprocess
import os
import shutil

def generer_gitstats(repo_path, output_path):
    if not os.path.exists(repo_path):
        return {"error": "Le repo n'existe pas."}

    try:
        if os.path.exists(output_path):
            shutil.rmtree(output_path)

        os.makedirs(output_path, exist_ok=True)

        subprocess.check_call([
            "gitstats", repo_path, output_path
        ])

        return {"success": True}
    except subprocess.CalledProcessError as e:
        return {"error": f"GitStats a échoué : {e}"}
    except Exception as e:
        return {"error": str(e)}
