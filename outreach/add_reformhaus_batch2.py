import openpyxl
path = '/home/user/bookreadingplatform/outreach/ginger_shoc_outreach_tracker.xlsx'
wb = openpyxl.load_workbook(path)
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

def new_sheet(name):
    ws = wb.create_sheet(name)
    ws.append(headers)
    return ws

ws = new_sheet('Essen')
rows = [
('Essen','Reformhaus','Reformhaus Kaubisch (Hauptstraße)','Hauptstr. 46, 45219 Essen','TBD','TBD','https://reformhaus.de/blogs/vita-nova/reformhaus-kaubisch','info@reformhaus-kaubisch.de','Found','Vita Nova chain (Kaubisch OHG, HQ Oberhausen) — reuse contact for other Kaubisch branches across NRW.'),
('Essen','Reformhaus','Reformhaus Bacher (Limbecker Platz)','Limbecker Platz 1A, 45127 Essen','TBD','TBD','https://reformhaus.de/blogs/reformhaus-bacher/','mail@reformhaus-bacher.de','Found','Same Bacher chain as Düsseldorf/Hannover branches — reuse contact.'),
('Essen','Reformhaus','Steeler Reformhaus','Kaiser-Otto-Platz 13, 45276 Essen-Steele','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
('Essen','Reformhaus','Reformhaus (Rüttenscheider Straße)','Rüttenscheider Str. 83, 45130 Essen','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Bremen')
rows = [
('Bremen','Reformhaus','Reformhaus Ebken (Innenstadt)','Hamburger Str. 7 / Innenstadt, Bremen','+49 421 326191','TBD','https://reformhaus.de/blogs/reformhaus-ebken/','info@ebken.de','Found','Chain with 5+ Bremen branches (Innenstadt, Ostertor, Neustadt/Pappelstraße, Horn, Vahr/Berliner Freiheit) — reuse this contact for all.'),
('Bremen','Reformhaus','Reformhaus Ebken (Ostertor)','Bremen-Ostertor (Das Viertel)','+49 421 7909377','TBD','https://reformhaus.de/blogs/reformhaus-ebken/','info@ebken.de','Found','Same Ebken chain.'),
('Bremen','Reformhaus','Reformhaus Ebken (Neustadt/Pappelstraße)','Pappelstr. 86, 28199 Bremen','+49 421 506072','TBD','https://reformhaus.de/blogs/reformhaus-ebken/','info@ebken.de','Found','Same Ebken chain; also has attached Naturkosmetikstudio SchönSinn.'),
('Bremen','Reformhaus','VITALIA Reformhaus (Berliner Freiheit EKZ)','Berliner Freiheit 3D, 28327 Bremen','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain reused from Berlin/Hamburg/Munich/Stuttgart/Leipzig.'),
('Bremen','Reformhaus','Reformhaus Bühring','Reeder-Bischoff-Str. 58, 28757 Bremen','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Dresden')
rows = [
('Dresden','Reformhaus','Reformhaus Ferstl','Loschwitzer Str. 52a, 01309 Dresden','+49 351 3144817','TBD','TBD — no dedicated website found; may be part of Vita Nova "NaturErlebnis" line','TBD','Not started','Directory listing references a related Vita Nova brand at this same Loschwitzer Str. address — verify relationship before contacting.'),
('Dresden','Reformhaus','Reformhaus Bioline','Bahnhofstraße 56, 01259 Dresden','+49 351 2010233','TBD','https://www.reformhaus-bioline.de/','info@reformhaus-bioline.de','Found','Also has a branch at Elbe Park shopping center — reuse contact.'),
('Dresden','Reformhaus','Reformhaus Mewald','Webergasse 1 (Altmarkt-Galerie), 01067 Dresden','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent, shopping mall location.'),
('Dresden','Reformhaus','Reformhaus Langner','Prager Str. 15, 01069 Dresden','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent, main pedestrian shopping street near Hauptbahnhof.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Hannover')
rows = [
('Hannover','Reformhaus','Reformhaus (Ernst-August-Platz, Hauptbahnhof)','Ernst-August-Platz 1, Hannover','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent, in main train station promenade — verify chain affiliation.'),
('Hannover','Reformhaus','Reformhaus (Osterstraße)','Osterstraße 22, 30159 Hannover-Mitte','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
('Hannover','Reformhaus','Reformhaus Bacher (Brabeckstraße)','Brabeckstr. 2, 30559 Hannover','TBD','TBD','https://reformhaus.de/blogs/reformhaus-bacher/','mail@reformhaus-bacher.de','Found','Same Bacher chain as Düsseldorf/Essen branches — reuse contact.'),
('Hannover','Reformhaus','Reformhaus (Schlägerstraße, Südstadt)','Schlägerstr. 41, 30171 Hannover','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Nuremberg')
rows = [
('Nuremberg','Reformhaus','Reformhaus am Hauptmarkt (Vita Nova Sattran)','Hauptmarkt 6-8, 90403 Nürnberg','+49 911 224078','TBD','https://vita-nova.de/standorte/reformhaus-sattran/','Contact via vita-nova.de/standorte/reformhaus-sattran/ contact page — no direct email confirmed','Partial','Vita Nova chain branch (same brand family as Berlin/Hamburg Engelhardt, Stuttgart Escher).'),
('Nuremberg','Reformhaus','VITALIA Reformhaus (Breite Gasse)','Breite Gasse 42, 90402 Nürnberg','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain reused across cities.'),
('Nuremberg','Reformhaus','Reformhaus Mögeldorf','Mögeldorfer Hauptstraße 49, 90482 Nürnberg-Mögeldorf','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
('Nuremberg','Reformhaus','Reformhaus (Langwasser)','Glogauer Str. 30-38, 90473 Nürnberg','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
]
for r in rows: ws.append(r)

wb.save(path)
print('batch2 done')
