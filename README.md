# 🌐 Nexus Social

Nexus Social is a modern, high-performance, real-time social networking and collaborative workspace platform designed to bring teams and communities together. Built with a focus on speed, security, and premium user experience, the application leverages React 19, TypeScript, Vite, and Supabase.

---

## 📌 Table of Contents
1. [Overview](#-overview)
2. [The Problem Statement](#-the-problem-statement)
3. [Key Features](#-key-features)
4. [Tech Stack](#-tech-stack)
5. [Folder Structure](#-folder-structure)
6. [Database Architecture](#-database-architecture)
7. [Authentication & Authorization Flow](#-authentication--authorization-flow)
8. [Installation & Local Setup](#-installation--local-setup)
9. [Environment Variables](#-environment-variables)
10. [Vercel Deployment Guide](#-vercel-deployment-guide)
11. [Future Roadmap](#-future-roadmap)

---

## 📖 Overview

Nexus Social is a hybrid platform that blends the engagement of public social media (feeds, profiles, likes, comments, leaderboards) with the productivity of structured work spaces (multi-tenant organizations, real-time shared documents, and file management). 

---

## ⚡ The Problem Statement

Traditional workspaces suffer from **app fatigue** and **context switching**. Teams are forced to bounce between separate tools for company announcements (Slack/Feeds), direct messages, document collaboration (Google Docs), and task tracking. 

**Nexus Social solves this by consolidating these pillars into one tool:**
* Ephemeral social updates live side-by-side with collaborative documents.
* Multi-tenant data segregation keeps organizational data fully private.
* Built-in gamification motivates active contribution.

---

## ✨ Key Features

### 1. Unified Social Feeds
* **Global & Following Filters:** Choose between seeing all platform updates or focusing only on users you follow.
* **"For You" Personalized Feed:** Incorporates a PostgreSQL recommendation engine calculating scores based on follower affinity, liked topics, and content recency.
* **Infinite Scroll & Tag Filtering:** Smoothly fetch paginated data using intersection observers.

### 2. Multi-Tenant Organization & Workspace Console
* **Tenant Isolation:** Create organizations that isolate feeds, members, files, and notes from other tenants.
* **Portal Invitations:** Invite users by username to join organizations with role assignments (`Member` / `Admin` / `Owner`).

### 3. Real-Time Collaborative Notes & Docs
* **Simultaneous Co-Editing:** Powered by Supabase Broadcast and Presence channels, allowing developers to see active cursors and edit notes collaboratively.
* **Stale Update Prevention:** Utilizes a sequence-number system to prevent slower in-flight network packets from overwriting newer local typing changes.
* **Version History:** Tracks changes and enables one-click restoration of older note revisions.

### 4. Interactive Notification Center
* Receive instant, real-time alerts when users like your posts, comment on your posts, or follow your profile.
* Read/unread toggles and clean optimistic state deletions.

### 5. Gamification Hub
* Earn reputation points dynamically through community activity.
* Clean leaderboard podium for top contributors and unlockable milestone badges.

---

## 🛠️ Tech Stack

* **Frontend:** React 19 (Hooks, Contexts), TypeScript, Vite (optimized build pipelines), Framer Motion (premium micro-animations), React Icons.
* **Backend & Database:** Supabase (Auth, PostgreSQL Database, Realtime Subscriptions, Edge Functions, Row-Level Security policies).
* **Styles:** Custom Vanilla CSS featuring glassmorphic designs, variable-driven color spaces, and dark mode optimizations.
* **Hosting:** Vercel (Production configuration with client-side router rewrites and security headers).

---

## 📁 Folder Structure

```
supabase-app/
├── .vscode/                 # Editor configurations
├── src/
│   ├── components/          # Reusable UI components (Comments, File Manager, Feature Guards)
│   ├── context/             # React Contexts (Tenant, Auth, Theme)
│   ├── hooks/               # Custom hooks (useAuth, useFeatureFlags)
│   ├── layouts/             # Page structural layouts (DashboardLayout)
│   ├── lib/                 # Core utilities (supabaseClient, auditLogger, cacheManager)
│   ├── pages/               # Page Components (Feed, Chat, Admin Console, Leaderboard)
│   ├── App.tsx              # Root Router entry point
│   ├── main.tsx             # Application mounter
│   └── index.css            # Custom theme configurations & styling system
├── supabase/                # Database migrations & seed scripts
├── vercel.json              # Routing rewrite rules and security headers
├── vite.config.ts           # Bundler and code-splitting rules
└── package.json             # Dependencies manifest
```

---

## 🗄️ Database Architecture

The application runs on PostgreSQL via Supabase. Data visibility is enforced at the database level using **Row Level Security (RLS)**.

```
+------------------+         +------------------+         +------------------+
|   profiles       | ------->|   memberships    | <------- |  organizations   |
| (user meta, pts) |         | (owner, admin)   |         |                  |
+------------------+         +------------------+         +------------------+
         |                                                          |
         |                                                          |
         v                                                          v
+------------------+                                      +------------------+
|      posts       | ------------------------------------>|    workspaces    |
| (likes, comments)|                                      |                  |
+------------------+                                      +------------------+
```

### Key Tables:
* `profiles`: Extends Supabase auth details, holding user reputation points, usernames, and avatar configurations.
* `shared_notes` / `shared_note_versions`: Powers document co-editing and revisions history.
* `invitations`: Handles team member onboarding.
* `audit_logs`: Records administrative moderation activities.

---

## 🔐 Authentication & Authorization Flow

1. **User Sign Up/Login:** Handled securely via Supabase Auth, returning a JWT.
2. **Session Persistence:** Configured in `AuthProvider.tsx` to mount authentication states across page reloads.
3. **Role-Based Guards:** Private pages check user permissions (`Moderator`, `Admin`) before rendering routes.
4. **Database RLS Policies:** Every SQL query passes through validation rules to verify the logged-in user has permission to read or write the row.

---

## 💻 Installation & Local Setup

### Prerequisites
* Node.js (v18+)
* npm or yarn

### Steps
1. **Clone the Repository:**
   ```bash
   git clone https://github.com/afzaljadoon/Nexus-social.git
   cd Nexus-social
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env.local` file in the root folder and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Launch Local Server:**
   ```bash
   npm run dev
   ```
   Open your browser at `http://localhost:5173`.

---

## 🌐 Vercel Deployment Guide

Vercel reads the configured `vercel.json` file automatically to handle:
* **Client-Side Routing:** Prevents 404 errors on page reloads by rewriting requests to `index.html`.
* **Security Headers:** Enforces HTTP strict security settings (X-Frame-Options, Content Security Policies, HSTS, etc.).
* **Cache Control:** Configures long-term immutable caching for static assets.

### Deploying the App:
1. Push your latest code changes to your Git provider.
2. Link the repository inside your Vercel Dashboard.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as production environment variables under Project Settings.
4. Deploy!

---

## 🚀 Future Roadmap

* [ ] **Direct Messaging Channels:** Adding private end-to-end encrypted messaging threads.
* [ ] **Collaborative Task Boards:** Agile style board built into workspaces.
* [ ] **Supabase Storage integration:** Drag-and-drop file support directly inside the FileManager component.
* [ ] **AI-Powered Moderation Logs:** Automatic flagging of toxic comments using advanced LLM models.
