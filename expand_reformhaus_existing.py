import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')

# --- Hamburg: add more Vita Nova / Reformhaus Engelhardt branches already found ---
ws = wb['Hamburg']
extra_hamburg = [
('Hamburg','Reformhaus','Reformhaus Engelhardt (Eppendorfer Baum)','Eppendorfer Baum 9, 20249 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact as other Engelhardt branches','Partial','Vita Nova chain branch.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Eppendorfer Landstr.)','Eppendorfer Landstr. 62, 20249 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Quarree, Wandsbek)','Quarree 8-10, 22041 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Wandsbek shopping center.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Alstertal-EKZ)','Heegbarg 31, 22391 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Alstertal shopping center.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Elbe-EKZ, Osdorf)','Osdorfer Landstr. 131, 22609 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Elbe-Einkaufszentrum.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Mercado, Ottensen)','Ottenser Hauptstr. 10, 22765 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Mercado Ottensen.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Bergedorf)','Weidenbaumsweg 21, 21029 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Bergedorf.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Volksdorf)','Claus Ferck Straße 3, 22359 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Volksdorf.'),
('Hamburg','Reformhaus','Reformhaus Engelhardt (Blankenese)','Blankeneser Bahnhofstr. 4, 22587 Hamburg','TBD','TBD','https://vita-nova.de/standorte/reformhaus-engelhardt/','Same Vita Nova chain contact','Partial','Vita Nova chain branch, Blankenese.'),
]
for r in extra_hamburg:
    ws.append(r)

# --- Munich: add more VITALIA branches already found ---
ws = wb['Munich']
extra_munich = [
('Munich','Reformhaus','VITALIA Reformhaus (Thomas-Dehler-Straße)','Thomas-Dehler-Straße 12, 81737 München','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain — reuse contact.'),
('Munich','Reformhaus','Reformhaus (Bäckerstraße, Pasing)','Bäckerstr. 4, 81241 München-Pasing','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent branch — verify chain affiliation.'),
('Munich','Reformhaus','Reformhaus (Friedastraße, Thalkirchen)','Friedastr. 24, 81371 München-Thalkirchen','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent branch — verify chain affiliation.'),
('Munich','Reformhaus','VITALIA Reformhaus (Hohenzollernstr. 88)','Hohenzollernstr. 88, 80796 München-Schwabing-West','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain — reuse contact.'),
]
for r in extra_munich:
    ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('done')
