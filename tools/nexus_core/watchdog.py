#!/usr/bin/env python3
import argparse, subprocess, sys, time, os
ap=argparse.ArgumentParser()
ap.add_argument('--port',type=int,default=5799)
ap.add_argument('--base',default='D:/Temp/nc-watchdog')
ap.add_argument('--log',default='D:/Temp/watchdog.log')
args=ap.parse_args()
log=open(args.log,'a')
while True:
    p=subprocess.Popen([sys.executable,'tools/nexus_core/api.py','--port',str(args.port),'--base',args.base], stdout=log, stderr=subprocess.STDOUT, env=dict(os.environ,PYTHONPATH='.'))
    p.wait()
    log.write(f'daemon exited {p.returncode}; restarting in 3s\n'); log.flush()
    time.sleep(3)
