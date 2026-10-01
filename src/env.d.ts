import type { PublicUser } from './lib/auth';
declare global {
  namespace App {
    interface Locals {
      user: PublicUser | null;
    }
  }
}
export {};
