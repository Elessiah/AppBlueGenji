#!/bin/bash

set -e

echo "=== Déploiement du site BlueGenji avec PM2 ==="

# 1. Mise à jour du système
echo "[+] Mise à jour du système..."
sudo apt update && sudo apt upgrade -y

# 2. Installer Node.js + npm si non installés
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[+] Node.js ou npm non détecté. Installation..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "[✓] Node.js et npm sont déjà installés."
fi

# 3. Installer PM2 si nécessaire
if ! command -v pm2 >/dev/null 2>&1; then
    echo "[+] PM2 non installé. Installation..."
    sudo npm install -g pm2
else
    echo "[✓] PM2 est déjà installé."
fi

# 4. Installer Mariadb si nécessaire
if ! command -v mariadb >/dev/null 2>&1 && ! command -v mariadb >/dev/null 2>&1; then
    echo "[+] MariaDB et Mariadb non installé. Installation de MariaDB..."
    sudo apt install mariadb-server mariadb-client -y
    sudo systemctl enable mariadb
    sudo systemctl start mariadb
else
    echo "[✓] Mariadb déjà installé."
fi

# 5. Récupération des infos Mariadb
read -r -p "Entrez l'utilisateur Mariadb à utiliser: " MARIADB_USER
read -r -p "Entrez le mot de passe Mariadb: " MARIADB_PASS
echo ""
read -r -p "Entrez le nom de la base de données: " MARIADB_DB

# 5.1 Création de l'utilisateur si nécessaire
read -r -p "Faut-il créer l'utilisateur '$MARIADB_USER' dans Mariadb ? (Y/n) : " CREATE_MARIADB_USER

if [[ "$CREATE_MARIADB_USER" =~ ^[Yy]$ ]]; then
    echo "[+] Création de l'utilisateur '$MARIADB_USER' et de la base '$MARIADB_DB'..."

    sudo mariadb <<EOF
CREATE USER IF NOT EXISTS '$MARIADB_USER'@'localhost' IDENTIFIED BY '$MARIADB_PASS';
CREATE DATABASE IF NOT EXISTS $MARIADB_DB;
GRANT ALL PRIVILEGES ON $MARIADB_DB.* TO '$MARIADB_USER'@'localhost';
FLUSH PRIVILEGES;
EOF

    echo "[✓] Utilisateur et base créés."
else
    echo "[...] Tentative d'utilisation de l'utilisateur '$MARIADB_USER'..."
    # Tu peux mettre ici une vérification ou un test de connexion si tu veux
fi


# 6. Vérification/Création de la base de données
DB_EXISTS=$(mariadb -u"$MARIADB_USER" -p"$MARIADB_PASS" -e "SHOW DATABASES LIKE '$MARIADB_DB';" 2>/dev/null | grep "$MARIADB_DB" || true)
if [ -z "$DB_EXISTS" ]; then
    echo "[+] Base $MARIADB_DB non trouvée. Création..."
    sudo mariadb -u"$MARIADB_USER" -p"$MARIADB_PASS" -e "CREATE DATABASE $MARIADB_DB;"
else
    echo "[✓] Base $MARIADB_DB déjà existante."
fi

# 7. Domaine
read -r -p "Entrez le nom de domaine du site (ex: bluegenji-esport.fr): " DOMAIN_NAME

# 8. Clonage du dépôt
echo "[+] Clonage du dépôt Git..."
git clone git@github.com:Elessiah/AppBlueGenji.git
cd AppBlueGenji

# 9. Préparation du dépôt
ROOT_REPO=$(pwd)
# 9.1 Création du .env
sudo bash -c "cat > $ROOT_REPO/.env" <<EOF
DB_HOST=localhost
DB_USER=$MARIADB_USER
DB_PASSWORD=$MARIADB_PASS
DB_DATABASE=$MARIADB_DB
EOF

# 9.2 Installation des dépendances
echo "[+] Installation des dépendances npm..."
npm install --force

# 10. Build de l'application
echo "[+] Construction du projet..."
npm run build

# 11. Lancement avec PM2
echo "[+] Lancement avec PM2..."
pm2 start npm --name bluegenji -- run start

# 12. Sauvegarde de l'état PM2 pour redémarrage auto
pm2 startup systemd -u "$USER" --hp "$HOME"
pm2 save

# 13. Installation Apache
if ! command -v apache2 >/dev/null 2>&1; then
    echo "[+] Apache2 non installé. Installation..."
    sudo apt install apache2 -y
    sudo systemctl enable apache2
    sudo systemctl start apache2
else
    echo "[✓] Apache2 déjà installé."
fi

# 14. Modules Apache nécessaires
sudo a2enmod proxy proxy_http rewrite ssl

# 15. Installation Certbot
if ! command -v certbot >/dev/null 2>&1; then
    echo "[+] Installation de Certbot..."
    sudo apt install -y certbot python3-certbot-apache
fi

# 16. Certificat SSL
echo "[+] Obtention du certificat SSL..."
sudo certbot --apache -d "$DOMAIN_NAME" --non-interactive --agree-tos -m admin@"$DOMAIN_NAME"

# 17. Configuration VirtualHost Apache
echo "[+] Configuration d'Apache avec redirection HTTPS..."

sudo bash -c "cat > /etc/apache2/sites-available/$DOMAIN_NAME.conf" <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN_NAME
    Redirect permanent / https://$DOMAIN_NAME/
</VirtualHost>

<VirtualHost *:443>
    ServerName $DOMAIN_NAME

    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$DOMAIN_NAME/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN_NAME/privkey.pem

    ErrorLog \${APACHE_LOG_DIR}/${DOMAIN_NAME}_error.log
    CustomLog \${APACHE_LOG_DIR}/${DOMAIN_NAME}_access.log combined
</VirtualHost>
EOF

# 18. Activation du site + reload Apache
sudo a2ensite "$DOMAIN_NAME.conf"
sudo systemctl reload apache2

echo "=== ✅ Déploiement terminé avec succès ==="
echo "Le site est accessible à : https://$DOMAIN_NAME"
echo "L'application tourne via PM2 :"
pm2 status
