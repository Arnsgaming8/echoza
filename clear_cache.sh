#!/usr/bin/env bash

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

bump_storage_version() {
    local main_file="client/src/main.tsx"
    if [ ! -f "$main_file" ]; then
        echo "ERROR: $main_file not found"
        exit 1
    fi

    local current_version=$(grep -o "const STORAGE_VERSION = '[0-9]*'" "$main_file" | grep -o '[0-9]*')
    if [ -z "$current_version" ]; then
        echo "ERROR: Could not extract current STORAGE_VERSION from $main_file"
        exit 1
    fi

    local new_version=$((current_version + 1))

    sed -i "s/const STORAGE_VERSION = '[0-9]*'/const STORAGE_VERSION = '${new_version}'/" "$main_file"

    echo "✓ Storage version bumped from $current_version to $new_version"
}

 clear_cache() {
    echo "Clearing cache..."

    if [ -d "client/node_modules/.cache" ]; then
        rm -rf "client/node_modules/.cache"
        echo "✓ Cleared Vite build cache"
    fi

    if [ -d "client/dist" ]; then
        rm -rf "client/dist"
        echo "✓ Cleared dist/ directory"
    fi

    find "." -type f -name "*.log" -delete 2>/dev/null || true
    echo "✓ Cleared log files"
}

 verify_clearance() {
    echo "Verifying cache clearing..."

    if [ -d "client/dist" ]; then
        echo "WARNING: dist/ directory still exists"
    fi

    if [ -d "client/node_modules/.cache" ]; then
        echo "WARNING: Vite cache still exists"
    fi

    local current_version=$(grep -o "const STORAGE_VERSION = '[0-9]*'" "client/src/main.tsx" | grep -o '[0-9]*')
    if [ -z "$current_version" ]; then
        echo "ERROR: Invalid version after bump"
        exit 1
    fi

    echo "✓ Current version: $current_version"
}

echo "=== Echoza Pre-Deployment Cache Clear ==="
echo ""

echo "Step 1: Bumping storage version..."
bump_storage_version
echo ""

echo "Step 2: Clearing cache..."
clear_cache
echo ""

echo "Step 3: Verifying clearance..."
verify_clearance
echo ""

echo "=== Cache clear completed successfully ==="
echo ""
echo "Next steps:"
echo "1. Commit the updated main.tsx with new version"
echo "2. Run: npm run build (in client directory)"
echo "3. Deploy to Render or your hosting platform"
echo ""
echo "Users will automatically clear their browser cache on next visit due to version mismatch."
