.PHONY: up down start server web smoke build clean

up:
	docker compose up --build

down:
	docker compose down

# Играть: страница и API на одном порту (:8000)
start:
	./laterna.sh

# Локальный запуск без docker (SQLite)
server:
	cd server && uvicorn app.main:app --reload --port 8000

web:
	cd web && npm run dev

smoke:
	cd server && python smoke_test.py

build:
	cd web && npm run build

clean:
	rm -f server/lanterna.db
	rm -rf web/dist
