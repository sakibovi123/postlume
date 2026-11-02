import time

from django.core.management.base import BaseCommand

from apps.studio.models import RenderJob
from pipeline import jobs


class Command(BaseCommand):
    help = "Process render jobs from the database queue."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Drain the queue and exit")
        parser.add_argument("--interval", type=float, default=1.0)

    def handle(self, *args, once=False, interval=1.0, **options):
        stale = RenderJob.objects.filter(status="running").update(status="queued")
        if stale:
            self.stdout.write(f"requeued {stale} interrupted jobs")
        if once:
            self.stdout.write(f"ran {jobs.drain()} jobs")
            return
        self.stdout.write("worker started, waiting for render jobs...")
        while True:
            job = jobs.claim_next()
            if job:
                jobs.run(job)
            else:
                time.sleep(interval)
