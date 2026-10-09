/**
 * Konfigurasi Metro untuk monorepo pnpm.
 *
 * Expo sudah mendukung workspace secara otomatis sejak SDK 52, tetapi
 * package internal memakai prefiks `@osda/` yang tidak ada di registry publik.
 * `extraNodeModules` memastikanMetro menyelesaikan ke symlink workspace.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const akar = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// Paket workspace tidak boleh diambil dari node_modules paket aplikasi.
config.watchFolders = [path.resolve(akar, 'packages/contracts')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(akar, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
