#!/bin/bash
set -e

echo "🚴 Bootstrapping CosCycle Vite App..."

# Use npx to generate the React TS template in a temp folder
rm -rf temp-app
npx -y create-vite@latest temp-app --template react-ts

# Move all files (including hidden files like .gitignore) into our working directory
mv temp-app/* ./
mv temp-app/.* ./ 2>/dev/null || true
rmdir temp-app

echo "📦 Installing base dependencies & Leaflet..."
npm install
npm install leaflet react-leaflet vite-plugin-pwa
npm install -D @types/leaflet

echo "🗺️ Processing Sydney Map Data (this may take a few seconds)..."
mkdir -p public
# Filter for features where the 'lga' property matches Sydney or its adjacent municipalities
jq -c '{
  type: .type, 
  features: [.features[] | select(.properties.lga | type == "string" and test("(?i)^(Sydney|Bayside|Burwood|Canada Bay|Inner West|Lane Cove|North Sydney|Randwick|Waverley|Woollahra)$"))]
}' Existing_Bicycle_Network.json > public/sydney_bicycle_network.json

echo "✅ Setup complete! The data has been filtered."
echo "➡️ Please run: npm run dev"
