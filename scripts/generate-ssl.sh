#!/bin/bash
# Generate self-signed SSL certificates if they don't exist

SSL_DIR="/app/ssl"
mkdir -p \

if [ ! -f "\/cert.pem" ] || [ ! -f "\/key.pem" ]; then
    echo "Generating self-signed SSL certificates..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "\/key.pem" \
        -out "\/cert.pem" \
        -subj "/C=US/ST=State/L=City/O=DESKSOS/CN=localhost"
    echo "✅ SSL certificates generated successfully"
else
    echo "✅ SSL certificates already exist"
fi
