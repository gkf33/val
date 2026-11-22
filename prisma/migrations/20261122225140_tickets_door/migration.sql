-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "dayReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "checkedOutAt" TIMESTAMP(3);
