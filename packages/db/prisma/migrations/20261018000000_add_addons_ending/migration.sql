-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "addOnsEnding" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "addOnsEndAt" TIMESTAMP(3);
