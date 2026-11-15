# Changelog

All notable changes to this project are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.0 (2026-11-15)


### Features

* add a container healthcheck and publish the image on release (M2) ([#22](https://github.com/Jivadio/solde/issues/22)) ([6daee69](https://github.com/Jivadio/solde/commit/6daee69b38b056237d9c98c11db35c9622961e3d))
* **api:** add the /api/v1 REST API and wire the server (M2b) ([#17](https://github.com/Jivadio/solde/issues/17)) ([65b1027](https://github.com/Jivadio/solde/commit/65b102763d33585862c4535d6ed98b7c5a873dd9))
* **browser-helper:** add the local browser-helper service (T4) ([#13](https://github.com/Jivadio/solde/issues/13)) ([ec14d89](https://github.com/Jivadio/solde/commit/ec14d8975f2f2b00fd8465fcf56dc69fb5a04424))
* **connectors:** add the connector SDK and fake-bank reference connector ([#9](https://github.com/Jivadio/solde/issues/9)) ([aa76790](https://github.com/Jivadio/solde/commit/aa76790dca155376511c9e44d81bbda14b4abf0b))
* **core-domain:** add household domain model, Money and permissions (M2a) ([#14](https://github.com/Jivadio/solde/issues/14)) ([9965338](https://github.com/Jivadio/solde/commit/99653380525406a38f54339be325a0067fdb6590))
* **docker:** ship the web app in the image and add compose e2e (M2b) ([#19](https://github.com/Jivadio/solde/issues/19)) ([5be9401](https://github.com/Jivadio/solde/commit/5be94019dd2f02aba1b1d9f2065b095f800efc7e))
* project foundation (milestone 0) ([#1](https://github.com/Jivadio/solde/issues/1)) ([9479306](https://github.com/Jivadio/solde/commit/9479306c73414607540a98f6c012845d50f7e2e4))
* rename the project to Solde and add the Ledger design system ([#4](https://github.com/Jivadio/solde/issues/4)) ([1f1590b](https://github.com/Jivadio/solde/commit/1f1590ba190982c66984c49840be11977be8d7ad))
* **services:** add household use cases behind visible_account_ids (M2b) ([#16](https://github.com/Jivadio/solde/issues/16)) ([2568677](https://github.com/Jivadio/solde/commit/256867782130e9108105ad90825fdb26dbc71cd8))
* **storage:** add the dual-backend SQLx store and M2 schema (M2b) ([#15](https://github.com/Jivadio/solde/issues/15)) ([f76d725](https://github.com/Jivadio/solde/commit/f76d7254532072afc6aac96793d185645e1d6735))
* **web:** add setup, sign-in, accounts and sharing screens (M2b) ([#18](https://github.com/Jivadio/solde/issues/18)) ([ff6def3](https://github.com/Jivadio/solde/commit/ff6def347efd2b9416c316eb04eb54ebcba8babe))
* **web:** add the app shell, overview and dialog-based forms (M2 design pass) ([#20](https://github.com/Jivadio/solde/issues/20)) ([906dbd2](https://github.com/Jivadio/solde/commit/906dbd2d134d07f23db19debcf7f2b0054019a2f))


### Bug Fixes

* **release:** bump every workspace crate in Cargo.lock ([#7](https://github.com/Jivadio/solde/issues/7)) ([5fa234f](https://github.com/Jivadio/solde/commit/5fa234fb3aa562ff6fff04cde5111516ed29d205))
* **release:** start releases at 0.1.0 ([#3](https://github.com/Jivadio/solde/issues/3)) ([040261f](https://github.com/Jivadio/solde/commit/040261f1227787d7bb9ee136eaf73d10e997d1e1))
* **storage:** check permissions and duplicates atomically with their writes ([#23](https://github.com/Jivadio/solde/issues/23)) ([ad4fc5c](https://github.com/Jivadio/solde/commit/ad4fc5c650c8bc407fb6b69ae8a7285fc23b526e))

## [Unreleased]

### Added

- Repository bootstrap: governance files, issue and PR templates, contribution guidelines.
