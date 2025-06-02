# PROJETGIT-BACKENDPY

PROJETGIT-BACKENDPY
├── app/
        ├── routes/
        ├── utils/
        ├── __init__.py
        ├── config.py
        ├── gitstat_utils.py
        ├── models.py
        ├── utils.py
├── archeologist/
        ├── backend/
                ├── Dockerfile
                ├── package.json
                ├── server.mjs
        ├── requirements.txt
├── code-archeologist/
        ├── backend/
        ├── package-lock.json
├── data/
├── .gitignore
├── .env
├── docker-compose.yml
├── Dockerfile.flask
├── main.py
├── README.md
├── requirements.txt


PARAMETRAGE
Pour changer la config (notamment de la BDD) il faut build de nouveau 
l'application avec les nouveaux paramètres

Port par défaut de MySQL : 3306

On peut rajouter des paramètres supplémentaires dans .env

A. Parametres pour les container Docker
docker-compose.yml

B. Parametres sans container
config.py



LANCER L'APPLICATION
A. Depuis un container Docker
--> Build :
docker-compose up --build
--> Run :
docker run -p 4000:4000 flask-repo-analyzer

B. Sans container (il faudra avoir installé au préalable la BDD, les dépendances, etc)
--> Lancer :
python backend/main.py


