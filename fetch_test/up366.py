import ctypes as ct
import tkinter as tk
import os
import sys
import scapy.all as scapy
import time
import re
import requests
import zipfile
import threading
from tkinter import messagebox


wind = tk.Tk()
last_packet = None
found = False
downtxt = ""
savedpath = ""


def on_closing():
    if messagebox.askokcancel("退出确认", "确定要退出程序吗？"):
        wind.destroy()


wind.protocol("WM_DELETE_WINDOW", on_closing)


def cleartk():
    for i in wind.winfo_children():
        i.destroy()


def convert(path):
    cleartk()
    labd = tk.Label(wind, text="已拿到核心，正在提取答案...", font=("微软雅黑", 12))
    labd.pack(pady=20)
    with open(path,'r', encoding="utf-8") as file:
        contxt = file.read()
    # 下面这一段借鉴了EverNightCN的写法
    # https://github.com/EverNightCN/up366/blob/main/up366.py
    # 感谢大佬，貌似没写许可类型就模仿了一下，主要pattern不会写
    # 如侵权立删
    pattern = r'"answer_text"(.*?)"knowledge"'
    matches = re.findall(pattern, contxt, re.DOTALL)
    anstxt = []
    for i in matches:
        anstxt.append(i.strip())
    ans = []
    for i in anstxt:
        option = re.search(r'[A-D]', i).group()
        parretn = r'"id":"{}"(.*?)"content":"(.*?)"'.format(option)
        match = re.search(pattern, i)
        if match:
            ans.append(match.group(2))
    with open("ans" + path[4:], 'w') as file:
        for i in range(1, len(ans)+1):
            file.write(str(i) + '.' + ans[i - 1])


def remove_tree(path):
    for root, dirs, files in os.walk(path, topdown=False):
        for name in files:
            os.remove(os.path.join(root, name))
        for name in dirs:
            os.rmdir(os.path.join(root, name))
    os.rmdir(path)


def decode_zip(path):
    cleartk()
    labd = tk.Label(wind, text="已拿到文件，正在解压...", font=("微软雅黑", 12))
    labd.pack(pady=20)
    temp_dir = path[0:len(path)-4]
    if os.path.exists(temp_dir):
        remove_tree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)
    try:
        with zipfile.ZipFile(path, 'r') as zipref:
            zipref.extractall(path)
    except zipfile.BadZipFile:
        print("Not A Zip!")
        sys.exit()
    pagepath = os.path.join(temp_dir, "1", "page1.js")
    if not os.path.exists(pagepath):
        print("File Not Found!")
        sys.exit()
    convert(path)
    

def download_file(url, save_path):
    cleartk()
    labd = tk.Label(wind, text="已拿到链接，正在下载...", font=("微软雅黑", 12))
    labd.pack(pady=20)
    try:
        if os.path.exists(save_path):
            os.remove(save_path)
        global savedpath
        savedpath = save_path
        response = requests.get(url, stream = True)
        response.raise_for_status()
        if not response.headers.get("Content-Type", "").startswith("application/zip"):
            print("Warning: The Downloaded File Isn't In A Zip Form!")

        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        decode_zip(save_path)
        return
    except:
        print("Download Failed!!!")
        sys.exit()


def myhandler(packet):
    global found
    global last_packet
    if (packet.haslayer(scapy.TCP) and packet.haslayer(scapy.Raw)):
        try:
            data = packet[scapy.Raw].load.decode('utf-8', errors = 'ignore')
        except:
            return
        if data.startswith("POST"):
            lines = data.splitlines()
            if (len(lines)) > 0:
                request_line = lines[0]
                parts = request_line.split(" ")
                if (len(parts) >= 2):
                    url = parts[1]
                    if "fileinfo" in url:
                        found = True
                        last_packet = packet


def decodepacket(mode, fnme):
    cleartk()
    labd = tk.Label(wind, text = "已获取到题目,正在反抓取链接")
    labd.pack()
    global downtxt
    if (mode == 1):
        rdpacket = scapy.rdpcap("temp/" + fnme)[0]
    else:
        rdpacket = last_packet
    if rdpacket.haslayer(scapy.Raw):
        try:
            rawtext = rdpacket[scapy.Raw].load.decode('utf-8', errors='ignore')
            rawlist = rawtext.splitlines()
            for i in rawlist:
                match = re.search(r'"downloadUrl":"(.*?)"', i)
                if match:
                    downtxt = match.group(1)
                    download_file(downtxt, fnme[0:len(fnme)-5] + ".zip")
                    return
            print("Failed!?")
            sys.exit()
        except:
            sys.exit()



def catch1():
    cleartk()
    # labd = tk.Label(wind, text = "请下载需要做的题目(等待中)")
    # btn2 = tk.Button(wind, command = sys.exit, text = "中止")
    labd = tk.Label(wind, text="请下载需要做的题目(等待中)", font=("微软雅黑", 12))
    labd.pack(pady=10)
    btn2 = tk.Button(wind, command=sys.exit, text="中止", width=15, font=("微软雅黑", 10))
    btn2.pack(pady=10)
    def bk(packet):
        global found
        if (found):
            cleartk()
        return found
    def sniff_thread():
        global last_packet
        scapy.sniff(filter = "host 127.0.0.1 and port 5291", prn = myhandler, stop_filter = bk)
        filename = f"temp/catch_{int(time.time())}.pcap"   
        scapy.wrpcap(filename, [last_packet])
        wind.after(0, lambda: decodepacket(0, filename))
    threading.Thread(target=sniff_thread, daemon=True).start()


def strt():
    cleartk()
    def on_finish1():
        catch1()
    # labd = tk.Label(wind, text = "请将天学网客户端代理设置为127.0.0.1,端口5291(在登陆界面)")
    # btn1 = tk.Button(wind, command = on_finish1, text = "完成")
    labd = tk.Label(wind, text="请将天学网客户端代理设置为\n127.0.0.1:5291（在登录界面）", font=("微软雅黑", 12), justify="center")
    labd.pack(pady=20)
    btn1 = tk.Button(wind, command=catch1, text="完成设置，继续", width=25, font=("微软雅黑", 11))
    btn1.pack(pady=10)


def init():
    wind.title("天学网题目自动处理器")
    wind.geometry("400x250")
    wind.resizable(False, False)
    screen_width = wind.winfo_screenwidth()
    screen_height = wind.winfo_screenheight()
    x = int((screen_width - 400) / 2)
    y = int((screen_height - 250) / 2)
    wind.geometry(f"+{x}+{y}")
    os.makedirs('temp', exist_ok = True)
    os.makedirs('ans', exist_ok = True)
    content = tk.Frame(wind)
    content.pack(expand=True)
    labd = tk.Label(content, text="是否开始抓包", font=("微软雅黑", 12), justify="center")
    labd.pack()
    btn_frame = tk.Frame(content)
    btn_frame.pack()
    btn1 = tk.Button(btn_frame, command = strt, text = "开始", width=15, font=("微软雅黑", 11))
    btn2 = tk.Button(btn_frame, command = sys.exit, text = "退出", width=15, font=("微软雅黑", 11))
    btn1.pack(side="left", padx=10)
    btn2.pack(side="right", padx=10)
    wind.mainloop()


if __name__ == '__main__':
    init()
