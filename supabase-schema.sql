-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)

create table if not exists leads (
  id              text primary key,
  full_name       text not null default '',
  phone           text not null default '',
  email           text,
  machine_id      text not null default 'unknown',
  consent_granted boolean not null default false,
  status          text not null default 'חדש',
  tags            text not null default '',
  notes           text not null default '',
  created_at      text not null default ''
);

create table if not exists campaigns (
  id           text primary key,
  channels     text not null default '[]',
  audience     text not null default '{}',
  body         text not null default '',
  media_path   text,
  scheduled_at text,
  status       text not null default 'pending',
  recipients   integer not null default 0,
  sent_count   integer not null default 0,
  result_log   text not null default '',
  created_at   text not null default ''
);

create table if not exists promotions (
  id          text primary key,
  title       text not null default '',
  description text not null default '',
  badge       text not null default '',
  emoji       text not null default '🌿',
  active      boolean not null default false,
  sort_order  integer not null default 0,
  created_at  text not null default ''
);

-- Disable Row Level Security so the server key has full access
alter table leads      disable row level security;
alter table campaigns  disable row level security;
alter table promotions disable row level security;

-- Run these ALTER statements if tables already exist (safe to re-run):
alter table promotions add column if not exists machine_id text;

create table if not exists sms_log (
  id           text primary key,
  lead_id      text,
  phone        text not null default '',
  full_name    text not null default '',
  message_body text not null default '',
  channel      text not null default 'sms',
  status       text not null default 'sent',
  error        text,
  campaign_id  text,
  machine_id   text,
  sent_at      text not null default ''
);
alter table sms_log disable row level security;

create table if not exists machines (
  id         text primary key,
  name       text not null default '',
  location   text not null default '',
  status     text not null default 'active',
  notes      text not null default '',
  sort_order integer not null default 0,
  lat        double precision,
  lng        double precision,
  created_at text not null default ''
);
alter table machines disable row level security;

-- Add GPS columns to existing machines table if already created without them:
alter table machines add column if not exists lat double precision;
alter table machines add column if not exists lng double precision;
alter table machines add column if not exists sort_order integer not null default 0;

create table if not exists products (
  id           text primary key,
  name         text not null default '',
  price_before numeric(10,2) not null default 0,
  price_after  numeric(10,2) not null default 0,
  created_at   text not null default ''
);
alter table products disable row level security;
