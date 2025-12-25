# EloDex Web (Portfólio) 🧩⚡

Painel Web do **EloDex** (versão de portfólio), uma aplicação inspirada no universo Pokémon, com foco em **regras de negócio**, **gestão de dados** e **operações administrativas** (Admin).

> ✅ Este repositório é público para fins de portfólio, porém **configs sensíveis** e **segredos** não são versionados.

---

## 🎯 Sobre o EloDex

O EloDex é um produto pensado para uso por clientes, com uma experiência gamificada e regras claras de progressão.  
Nesta versão Web (Admin), o objetivo é oferecer ferramentas de gestão e manutenção do ecossistema: dados, usuários, itens, missões e configurações.

---

## 🧠 Principais Funcionalidades (Web/Admin)

- **Autenticação e proteção de rotas**
- **Painel com navegação (Sidebar)**
- **Pokédex (consulta e detalhamento)**
- **Gestão de usuários** (visualização, filtros e detalhes)
- **Gestão de itens**
- **Gestão de missões e eventos** (cadastro/edição de regras e recompensas)
- **Scripts utilitários** para seed/atualização de dados

> Observação: algumas telas e fluxos podem estar simplificados por ser uma versão de portfólio.

---

## 🏗️ Arquitetura (alto nível)

- **Frontend:** Next.js (App Router) + TypeScript
- **Dados e Auth:** Firebase (Auth + Firestore)
- **Regras e Segurança:** Firestore Rules / Claims (admin)
- **Automação:** scripts Node para seed e organização de dados
- **Padrão:** componentes reutilizáveis + separação por módulos

---

## 🚀 Stack

- Next.js
- TypeScript
- Firebase Authentication
- Cloud Firestore
- Firebase Rules
- Node.js
- ESLint

---

## 🔐 Segurança (importante)

Este projeto utiliza variáveis de ambiente.  
Arquivos como `.env`, `.env.local` e `.env.production` **não são versionados**.

✅ O repositório contém apenas um contexto seguro para portfólio, sem exposição de segredos.

---

## ▶️ Rodando localmente

1) Instale dependências:
```bash
npm install
