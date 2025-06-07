#PROJETGIT_BACKENDPY/main.py : point d'entrée de l'application
import os

from dotenv import load_dotenv
load_dotenv()

from app import create_app
app = create_app()

BACKEND_PORT = os.getenv("BACKEND_PORT")

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=BACKEND_PORT)

#, use_reloader=False