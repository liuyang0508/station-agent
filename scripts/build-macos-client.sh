#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$ROOT_DIR/dist/macos/AIAgent Client.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_RESOURCE_DIR="$RESOURCES_DIR/app"
RUNTIME_DIR="$RESOURCES_DIR/runtime"
RUNTIME_BIN_DIR="$RUNTIME_DIR/bin"
RUNTIME_LIB_DIR="$RUNTIME_DIR/lib"
MODULE_CACHE_DIR="$ROOT_DIR/.build/module-cache"
ICON_BUILD_DIR="$ROOT_DIR/.build/icon"
PACKAGE_ZIP="$ROOT_DIR/dist/macos/AIAgent-Client-0.1.0-mac-arm64.zip"
PACKAGE_DMG="$ROOT_DIR/dist/macos/AIAgent-Client-0.1.0-mac-arm64.dmg"
MANIFEST_PATH="$ROOT_DIR/dist/macos/build-manifest.json"
BUILD_ID="$(date -u +%Y%m%d%H%M%S)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -e "$APP_DIR" ]; then
  BACKUP_DIR="$ROOT_DIR/dist/macos/.previous-$(date +%Y%m%d%H%M%S)"
  mkdir -p "$BACKUP_DIR"
  mv "$APP_DIR" "$BACKUP_DIR/"
  echo "Moved existing build to: $BACKUP_DIR"
fi

if [ -e "$PACKAGE_ZIP" ]; then
  mv "$PACKAGE_ZIP" "$ROOT_DIR/dist/macos/.previous-package-$(date +%Y%m%d%H%M%S).zip"
fi
if [ -e "$PACKAGE_DMG" ]; then
  mv "$PACKAGE_DMG" "$ROOT_DIR/dist/macos/.previous-dmg-$(date +%Y%m%d%H%M%S).dmg"
fi

mkdir -p "$MACOS_DIR" "$APP_RESOURCE_DIR" "$RUNTIME_BIN_DIR" "$RUNTIME_LIB_DIR" "$MODULE_CACHE_DIR" "$ICON_BUILD_DIR"

swiftc "$ROOT_DIR/macos/AIAgentClient.swift" \
  -o "$MACOS_DIR/AIAgentClient" \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -clang-scanner-module-cache-path "$MODULE_CACHE_DIR/clang-scanner" \
  -framework Cocoa \
  -framework WebKit

swiftc "$ROOT_DIR/macos/GenerateIcon.swift" \
  -o "$ROOT_DIR/.build/generate-icon" \
  -module-cache-path "$MODULE_CACHE_DIR" \
  -clang-scanner-module-cache-path "$MODULE_CACHE_DIR/clang-scanner" \
  -framework AppKit

"$ROOT_DIR/.build/generate-icon" "$ICON_BUILD_DIR/AIAgentIcon-1024.png"
sips -s format tiff "$ICON_BUILD_DIR/AIAgentIcon-1024.png" --out "$ICON_BUILD_DIR/AIAgentIcon.tiff" >/dev/null
tiff2icns "$ICON_BUILD_DIR/AIAgentIcon.tiff" "$RESOURCES_DIR/AIAgentIcon.icns"

cp "$ROOT_DIR/macos/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$ROOT_DIR/package.json" "$APP_RESOURCE_DIR/package.json"
cp "$ROOT_DIR/README.md" "$APP_RESOURCE_DIR/README.md"
ditto "$ROOT_DIR/public" "$APP_RESOURCE_DIR/public"
ditto "$ROOT_DIR/src" "$APP_RESOURCE_DIR/src"
ditto "$ROOT_DIR/docs" "$APP_RESOURCE_DIR/docs"
ditto "$ROOT_DIR/node_modules" "$APP_RESOURCE_DIR/node_modules"
cat > "$APP_RESOURCE_DIR/build-info.json" <<EOF
{
  "id": "$BUILD_ID",
  "builtAt": "$BUILT_AT",
  "version": "0.1.0"
}
EOF

resolve_existing_path() {
  local target="$1"
  local dir
  dir="$(cd "$(dirname "$target")" && pwd -P)"
  printf '%s/%s\n' "$dir" "$(basename "$target")"
}

copy_runtime_dependency() {
  local source="$1"
  if [ ! -e "$source" ]; then
    return 0
  fi

  local resolved
  resolved="$(resolve_existing_path "$source")"
  local dest="$RUNTIME_LIB_DIR/$(basename "$resolved")"
  if [ ! -e "$dest" ]; then
    cp "$resolved" "$dest"
    chmod u+w "$dest"
    RUNTIME_QUEUE+=("$dest")
  fi
}

copy_dependency_from_reference() {
  local reference="$1"
  local owner="$2"

  case "$reference" in
    /opt/homebrew/*|/usr/local/*)
      copy_runtime_dependency "$reference"
      ;;
    @rpath/*)
      local name="${reference#@rpath/}"
      if [ -e "$RUNTIME_LIB_DIR/$name" ]; then
        return 0
      fi
      local owner_dir
      owner_dir="$(dirname "$owner")"
      for candidate in \
        "$owner_dir/$name" \
        "$owner_dir/../lib/$name" \
        "/opt/homebrew/opt/node/lib/$name" \
        "/usr/local/opt/node/lib/$name"; do
        if [ -e "$candidate" ]; then
          copy_runtime_dependency "$candidate"
          return 0
        fi
      done
      for candidate in /opt/homebrew/opt/*/lib/"$name" /usr/local/opt/*/lib/"$name"; do
        if [ -e "$candidate" ]; then
          copy_runtime_dependency "$candidate"
          return 0
        fi
      done
      ;;
    @loader_path/*)
      local owner_dir
      owner_dir="$(dirname "$owner")"
      local relative="${reference#@loader_path/}"
      local candidate="$owner_dir/$relative"
      if [ -e "$candidate" ]; then
        copy_runtime_dependency "$candidate"
        return 0
      fi
      local name
      name="$(basename "$relative")"
      for candidate in /opt/homebrew/opt/*/lib/"$name" /usr/local/opt/*/lib/"$name"; do
        if [ -e "$candidate" ]; then
          copy_runtime_dependency "$candidate"
          return 0
        fi
      done
      ;;
    @executable_path/*)
      local relative="${reference#@executable_path/}"
      local candidate="$RUNTIME_BIN_DIR/$relative"
      if [ -e "$candidate" ]; then
        copy_runtime_dependency "$candidate"
      fi
      ;;
  esac
}

bundle_node_runtime() {
  local node_source=""
  for candidate in \
    "/opt/homebrew/opt/node/bin/node" \
    "/usr/local/opt/node/bin/node" \
    "$(command -v node || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      node_source="$candidate"
      break
    fi
  done

  if [ -z "$node_source" ]; then
    echo "Node.js was not found; building app with external-runtime fallback only." >&2
    return 0
  fi

  cp "$node_source" "$RUNTIME_BIN_DIR/node"
  chmod 755 "$RUNTIME_BIN_DIR/node"

  RUNTIME_QUEUE=("$RUNTIME_BIN_DIR/node")
  local index=0
  while [ "$index" -lt "${#RUNTIME_QUEUE[@]}" ]; do
    local owner="${RUNTIME_QUEUE[$index]}"
    index=$((index + 1))
    while IFS= read -r dependency; do
      copy_dependency_from_reference "$dependency" "$owner"
    done < <(otool -L "$owner" | awk 'NR > 1 { print $1 }')
  done

  local binary
  while IFS= read -r binary; do
    while IFS= read -r dependency; do
      case "$dependency" in
        /opt/homebrew/*|/usr/local/*)
          local new_ref
          if [ "$binary" = "$RUNTIME_BIN_DIR/node" ]; then
            new_ref="@loader_path/../lib/$(basename "$dependency")"
          else
            new_ref="@loader_path/$(basename "$dependency")"
          fi
          install_name_tool -change "$dependency" "$new_ref" "$binary" 2>/dev/null || true
          ;;
        @rpath/*)
          if [ "$binary" != "$RUNTIME_BIN_DIR/node" ]; then
            install_name_tool -change "$dependency" "@loader_path/$(basename "$dependency")" "$binary" 2>/dev/null || true
          fi
          ;;
      esac
    done < <(otool -L "$binary" | awk 'NR > 1 { print $1 }')

    if [[ "$binary" == *.dylib ]]; then
      install_name_tool -id "@loader_path/$(basename "$binary")" "$binary" 2>/dev/null || true
    fi
  done < <(find "$RUNTIME_DIR" -type f \( -name node -o -name '*.dylib' \))
}

bundle_node_runtime

while IFS= read -r runtime_binary; do
  codesign --force --sign - "$runtime_binary" >/dev/null
done < <(find "$RUNTIME_DIR" -type f \( -name node -o -name '*.dylib' \))

codesign --force --deep --sign - "$APP_DIR" >/dev/null
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$PACKAGE_ZIP"

DMG_STAGING_DIR="$ROOT_DIR/.build/dmg-staging"
if [ -e "$DMG_STAGING_DIR" ]; then
  mv "$DMG_STAGING_DIR" "$ROOT_DIR/.build/.previous-dmg-staging-$(date +%Y%m%d%H%M%S)"
fi
mkdir -p "$DMG_STAGING_DIR"
ditto "$APP_DIR" "$DMG_STAGING_DIR/AIAgent Client.app"
ln -s /Applications "$DMG_STAGING_DIR/Applications"
hdiutil create \
  -volname "AIAgent Client" \
  -srcfolder "$DMG_STAGING_DIR" \
  -format UDZO \
  "$PACKAGE_DMG" >/dev/null

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "AIAgent Client",
  "version": "0.1.0",
  "platform": "macOS arm64",
  "buildId": "$BUILD_ID",
  "builtAt": "$BUILT_AT",
  "app": "$APP_DIR",
  "zip": "$PACKAGE_ZIP",
  "dmg": "$PACKAGE_DMG",
  "runtime": {
    "nodeBundled": true,
    "nodePath": "$RUNTIME_BIN_DIR/node",
    "bundledLibraries": $(find "$RUNTIME_LIB_DIR" -type f -name '*.dylib' | wc -l | tr -d ' '),
    "nodeFallback": "External Node.js 22+ at /opt/homebrew/bin/node, /usr/local/bin/node, or /usr/bin/node"
  }
}
EOF

echo "Built: $APP_DIR"
echo "Packaged: $PACKAGE_ZIP"
echo "Installer: $PACKAGE_DMG"
