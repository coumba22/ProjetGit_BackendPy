#PROJETGIT_BACKENDPY/main.py : point d'entrée de l'application

from app import create_app
app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=4000)

#, use_reloader=False