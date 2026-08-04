.PHONY: help install dev backend build preview

help:
	@echo "MuVisual commands:"
	@echo "  make install   Install dependencies"
	@echo "  make dev       Start the Vite frontend"
	@echo "  make backend   Start the backend API"
	@echo "  make build     Build the production frontend"
	@echo "  make preview   Preview the production build"

install:
	npm install

dev:
	npm run dev

backend:
	npm run backend

build:
	npm run build

preview:
	npm run preview
