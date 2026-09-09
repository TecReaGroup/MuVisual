.PHONY: help install run dev backend build preview

help:
	@echo "MuVisual commands:"
	@echo "  make install   Install dependencies"
	@echo "  make run       Start the frontend and backend"
	@echo "  make dev       Start the Vite frontend"
	@echo "  make backend   Start the backend API"
	@echo "  make build     Build the production frontend"
	@echo "  make preview   Preview the production build"

install:
	npm install

run:
	$(MAKE) -j2 dev backend

dev:
	npm run dev

backend:
	npm run backend

build:
	npm run build

preview:
	npm run preview

docker-build:
	docker compose up -d --build

docker-push:
	docker build -t roupertrg/muvisual:latest .
	docker push roupertrg/muvisual:latest
