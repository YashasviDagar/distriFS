-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('HEALTHY', 'OFFLINE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "ReplicaStatus" AS ENUM ('PENDING', 'HEALTHY', 'CORRUPT', 'MISSING', 'QUARANTINED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "chunk_size" INTEGER NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "size" BIGINT NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunks" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_nodes" (
    "id" TEXT NOT NULL,
    "node_name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" "NodeStatus" NOT NULL DEFAULT 'HEALTHY',
    "capacity_bytes" BIGINT NOT NULL,
    "available_bytes" BIGINT NOT NULL,
    "last_heartbeat" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chunk_replicas" (
    "id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "status" "ReplicaStatus" NOT NULL DEFAULT 'PENDING',
    "stored_checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chunk_replicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "node_id" TEXT,
    "chunk_id" TEXT,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmark_runs" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "replication_factor" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "benchmark_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "files_owner_id_idx" ON "files"("owner_id");

-- CreateIndex
CREATE INDEX "file_versions_file_id_idx" ON "file_versions"("file_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_file_id_version_no_key" ON "file_versions"("file_id", "version_no");

-- CreateIndex
CREATE INDEX "chunks_version_id_idx" ON "chunks"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "chunks_version_id_chunk_index_key" ON "chunks"("version_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "storage_nodes_node_name_key" ON "storage_nodes"("node_name");

-- CreateIndex
CREATE INDEX "chunk_replicas_node_id_idx" ON "chunk_replicas"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "chunk_replicas_chunk_id_node_id_key" ON "chunk_replicas"("chunk_id", "node_id");

-- CreateIndex
CREATE INDEX "events_type_idx" ON "events"("type");

-- CreateIndex
CREATE INDEX "events_created_at_idx" ON "events"("created_at");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "file_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_replicas" ADD CONSTRAINT "chunk_replicas_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chunk_replicas" ADD CONSTRAINT "chunk_replicas_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "storage_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

