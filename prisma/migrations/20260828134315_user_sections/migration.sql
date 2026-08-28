-- AlterTable
ALTER TABLE "user" ADD COLUMN     "sections" TEXT[] DEFAULT ARRAY[]::TEXT[];
