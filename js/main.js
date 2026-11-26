function docReady(fn) {
	// see if DOM is already available
	if (document.readyState === "complete" || document.readyState === "interactive") {
		// call on next available tick
		setTimeout(fn, 1);
	} else {
		document.addEventListener("DOMContentLoaded", fn);
	}
}    

function IncludeHTML() {
	var z, i, elmnt, file, xhttp;

	/*loop through a collection of all HTML elements:*/
	z = document.getElementsByTagName("*");
	for (i = 0; i < z.length; i++) {
		elmnt = z[i];
		/*search for elements with a certain attribute:*/
		file = elmnt.getAttribute("w3-include-html");
		if (file) {
			/*make an HTTP request using the attribute value as the file name:*/
			xhttp = new XMLHttpRequest();
			xhttp.onreadystatechange = function() {
				if (this.readyState == 4) {
					if (this.status == 200) {elmnt.innerHTML = this.responseText;}
					if (this.status == 404) {elmnt.innerHTML = "Page not found.";}
					/*remove the attribute, and call this function once more:*/
					elmnt.removeAttribute("w3-include-html");
					IncludeHTML();
				}
			}      
			xhttp.open("GET", file, true);
			xhttp.send();
			/*exit the function:*/
			return;
		}
	}
}

function Toggle(el,classname) { 
	el.classList.toggle(classname) 
}

function OpenNewWindow(url) { 
	window.open(url,'_blank','resizable=yes') 
}

/*** Initial State of Buttons ***/
var aws=0,ali=0,azure=0,gcp=0,oci=0;
var countryHighlighting=false;
var countryCities=false;
var companyApprovedOnly=false;
var availabilityZonesVisible=false;
var markerRadius=5;

docReady(function() {
	if (!window.CSP_READY) {
		window.addEventListener('locations-ready', function() { docReady(arguments.callee); }, { once: true });
		return;
	}
	function showLocationTooltip(point, message) {
		if (!locationTooltip) return;
		var mapRect = document.querySelector('#map').getBoundingClientRect();
		var pointRect = point.node.getBoundingClientRect();
		var x = pointRect.left - mapRect.left + pointRect.width / 2;
		var y = pointRect.top - mapRect.top;
		locationTooltip.innerHTML = message.split('\n').map(function(line) {
			return line.replace(/[&<>"']/g, function(char) {
				return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
			});
		}).join('<br>');
		locationTooltip.style.display = 'block';
		locationTooltip.style.left = Math.max(8, Math.min(x + 12, mapRect.width - locationTooltip.offsetWidth - 8)) + 'px';
		locationTooltip.style.top = Math.max(8, y - locationTooltip.offsetHeight - 10) + 'px';
	}
	function hideLocationTooltip() {
		if (locationTooltip) locationTooltip.style.display = 'none';
	}
	var mapVerticalOffset = 0;
	var mapHorizontalScale = 0.88;
	var mapCenterX = 495;
	var mapCenterY = 225;

	/*** Object: Draws a circle ***/
	function Dot(Paper,x,y,radius,color,msg) {
		this.cx = x;
		this.cy = y;
		this.rad = radius;
		this.color = color;
		this.run = 1;
		this.dot = Paper.circle(this.cx,this.cy,this.rad).attr({"fill":this.color,"opacity":1,"stroke":"none"});
		this.msg = msg;

		if (msg) {
			var point=this.dot;
			point.node.onmouseover = function () {
				showLocationTooltip(point, msg);
			}
			point.node.onmouseout = function () {
				hideLocationTooltip();
			}
		}

		// *** Pulse or start the Wave effect ***
		this.Pulse = function(o) {
			var that = this;
			if (this.wave) {
				this.wave.show();
			} else {
				this.wave = Paper.circle(this.cx,this.cy,this.rad).attr({
					"stroke":this.color,
					"stroke-width":2,
					"opacity":0.4
				});
			}
			
			var fadeReset = function() { 
				that.wave.attr({r: that.rad}); 
				if (that.run) fadeOut(); 
			}
			var fadeOut = function() { 
				that.wave.animate({r: that.rad*3 },1000, "", fadeReset);
			}
			that.run=1;
			fadeReset();
		}

		// *** Stop the Wave effect ***
		this.Stop = function(o) {
			this.run=0;
			if (this.wave) { this.wave.hide(); }
		}
		return this;
	}

	/*** Object: Draws a country ***/
	function Country(Paper,country,color,docapital) {
		var animateOver = function() { 
			if (countryHighlighting && this.data("hoverFill")) {
				this.attr("fill", this.data("hoverFill"));
			}
		}
		var animateOut = function() {
			if (countryHighlighting && this.data("fill")) {
				this.attr("fill", this.data("fill"));
			}
		}
		var obj = Paper.path(WORLD[country].path).attr({
			"fill": color,
			"stroke": '#aeb9c8',
			"stroke-opacity": 0.72,
			"stroke-width": 0.35
		});
		//obj.click(handleDetails);
		obj.data("hoverFill", "#c7ddf2");
		obj.data("fill", color); 
		obj.hover(animateOver, animateOut);

		if (WORLD[country].name) {
			var msg = WORLD[country].name;
			obj.node.onmouseover = function (ev) {
				if (!countryHighlighting) { return; }
				if (popup2) {popup2.remove()};
				popup2 = rr.popup(ev.offsetX,ev.offsetY,msg,
					(ev.offsetX>350?'left':'right'));
			}
			obj.node.onmouseout = function () {
				if (popup2) {
					popup2.remove();
					popup2=null;
				};
			}
		}
		if (docapital) {
			if (WORLD[country].capital) {
				var attr = parseLatLon(WORLD[country].capital[0]);
				var name = WORLD[country].capital[1];
				obj.capital=new Dot(rr,attr.cx,attr.cy,2,"purple",name);
				if (!countryCities) { obj.capital.dot.hide(); }
			}
		}
		return obj;
	}

	function parseLatLon(latlon) {
		var getXY = function(lat,lon) {
			return { 
				cx: mapCenterX + (lon * 2.6938+465.4 - mapCenterX) * mapHorizontalScale,
				cy: lat * -2.6938+227.066 + mapVerticalOffset
			};
		}
		var l = latlon.split(",");
		return getXY(l[0],l[1]);
	}
	function locationMessage(record) {
		var lines = [
			record.csp,
			record.availabilityZone ? "Availability zone: " + record.availabilityZone : null,
			record.location || record.region,
			record.region ? "Region: " + record.region : null,
			record.state ? "Country: " + record.state : null,
			record.code && record.code !== "TBD" ? "ID: " + record.code : null,
			record.status || record.opened ? "Status: " + (record.status || record.opened) : null,
			record.dataCenterAddress ? "Address: " + record.dataCenterAddress : null,
			record.companyAccessStatus ? "Company access: " + record.companyAccessStatus : null
		];
		return lines.filter(function(line) { return line; }).join("\n");
	}
	function showCSPlocations(Paper) {
		for(var i = 0; i < CSP.length; i++) {
			var attr = parseLatLon(CSP[i].coord);
			var msg = locationMessage(CSP[i]);
			var col="";
			switch (CSP[i].csp) {
			case "AWS":   col="#ffb70e"; attr.cy-=1; break;
			case "Azure": col="blue";    attr.cx-=1; break;
			case "GCP":   col="#24b824"; attr.cx+=1; break;
			case "ALI":   col="#f59e0b"; attr.cx-=1; break;
			case "OCI":   col="#c74634"; attr.cx+=1; break;
			}

			var loc = new Dot(Paper,attr.cx,attr.cy,markerRadius,col,msg);
			loc.record = CSP[i];
			loc.isAvailabilityZone = false;
			loc.dot.hide();
			//loc.Pulse(); 

			switch (CSP[i].csp) {
			case "AWS":   awsSet.push(loc); break;
			case "Azure": azureSet.push(loc); break;
			case "GCP":   gcpSet.push(loc); break;
			case "ALI":   aliSet.push(loc); break;
			case "OCI":   ociSet.push(loc); break;
			}

			var zones = CSP[i].availabilityZones || [];
			for (var zoneIndex = 0; zoneIndex < zones.length; zoneIndex++) {
				var zone = zones[zoneIndex] || {};
				var zoneCoordinates = zone.coordinates || {};
				var zoneCoord = zone.coord || (Number.isFinite(Number(zoneCoordinates.lat)) && Number.isFinite(Number(zoneCoordinates.lon))
					? zoneCoordinates.lat + "," + zoneCoordinates.lon : null);
				if (!zoneCoord) continue;
				var zoneAttr = parseLatLon(zoneCoord);
				var zoneRecord = Object.assign({}, CSP[i], zone, {
					csp: CSP[i].csp,
					region: CSP[i].region,
					code: zone.id || zone.code || CSP[i].code,
					location: zone.location || zone.name || CSP[i].location,
					coord: zoneCoord,
					availabilityZone: zone.name || zone.id || zone.code || ""
				});
				var zoneMarker = new Dot(Paper, zoneAttr.cx, zoneAttr.cy, markerRadius, col, locationMessage(zoneRecord));
				zoneMarker.record = zoneRecord;
				zoneMarker.isAvailabilityZone = true;
				zoneMarker.dot.attr({"stroke":"#ffffff", "stroke-width":1});
				zoneMarker.dot.hide();
				switch (CSP[i].csp) {
				case "AWS": awsSet.push(zoneMarker); break;
				case "Azure": azureSet.push(zoneMarker); break;
				case "GCP": gcpSet.push(zoneMarker); break;
				case "ALI": aliSet.push(zoneMarker); break;
				case "OCI": ociSet.push(zoneMarker); break;
				}
			}
		}
	    //alert("aliSet: "+aliSet.length+" awsSet: "+awsSet.length+" azureSet: "+azureSet.length+" gcpSet: "+gcpSet.length);
	}
	function DrawMap(Paper) {
		for (var country in WORLD) {
			WORLD[country].obj=Country(Paper,country,"#EEE6ED",1);
		}
		var minY = Infinity;
		var maxY = -Infinity;
		for (var mappedCountry in WORLD) {
			if (!WORLD[mappedCountry].obj) continue;
			var bounds = WORLD[mappedCountry].obj.getBBox();
			minY = Math.min(minY, bounds.y);
			maxY = Math.max(maxY, bounds.y + bounds.height);
		}
		if (Number.isFinite(minY) && Number.isFinite(maxY)) {
			mapVerticalOffset = (mapHeight - (maxY - minY)) / 2 - minY;
			for (var centeredCountry in WORLD) {
				if (WORLD[centeredCountry].obj) {
					WORLD[centeredCountry].obj.transform("s" + mapHorizontalScale + ",1," + mapCenterX + "," + mapCenterY + "t0," + mapVerticalOffset);
					if (WORLD[centeredCountry].obj.capital) {
						WORLD[centeredCountry].obj.capital.cy += mapVerticalOffset;
						WORLD[centeredCountry].obj.capital.dot.transform("t0," + mapVerticalOffset);
					}
				}
			}
		}
		showCSPlocations(Paper);
	}

	/*** Main Code ***/
	var mapWidth=990;
	var mapHeight=450;
	var rr = Raphael('map', mapWidth, mapHeight);
	rr.canvas.setAttribute("viewBox", "0 0 "+mapWidth+" "+mapHeight);
	rr.canvas.setAttribute("preserveAspectRatio", "xMidYMid meet");
	var panZoom = rr.panzoom({ initialZoom: 0, initialPosition: { x: 120, y: 70} });
	var popup1 = null, popup2 = null;
	var locationTooltip = document.createElement('div');
	locationTooltip.className = 'location-tooltip';
	locationTooltip.style.display = 'none';
	document.querySelector('#map').appendChild(locationTooltip);
	var aliSet=[], awsSet=[], azureSet=[], gcpSet=[], ociSet=[];
	
	panZoom.enable();
	rr.canvas.setAttribute("preserveAspectRatio", "xMidYMid meet");
	/*** Clear the background ***/
	var overlay = rr.rect(0, 0, rr.width, rr.height).attr({ 
		//"fill": "#505250",
		//"fill": "#0378B4",
		"fill": "#65BCEA",
		"stroke": "none",		
		"fill-opacity": 1,
		"stroke-width": 0 
	});

	DrawMap(rr);

	function bringProviderToFront(set) {
		for (var markerIndex=0; markerIndex<set.length; markerIndex++) {
			set[markerIndex].dot.toFront();
			if (set[markerIndex].wave) { set[markerIndex].wave.toFront(); }
		}
	}
	function applyScreenStableMarkerScale() {
		var scale = 1 - (panZoom.getCurrentZoom() * 0.1);
		var providerSets=[aliSet,awsSet,azureSet,gcpSet,ociSet];
		for (var setIndex=0; setIndex<providerSets.length; setIndex++) {
			for (var markerIndex=0; markerIndex<providerSets[setIndex].length; markerIndex++) {
				var marker=providerSets[setIndex][markerIndex];
				marker.dot.attr('r', marker.rad * scale);
				if (marker.wave) marker.wave.attr('r', marker.rad * scale);
			}
		}
	}
	function markerIsAllowed(marker) {
		return (!marker.isAvailabilityZone || availabilityZonesVisible) &&
			(!companyApprovedOnly || (marker.record && marker.record.companyAccessStatus === "enabled"));
	}
	function updateProviderMarkers(set, active) {
		for (var markerIndex=0; markerIndex<set.length; markerIndex++) {
			var marker=set[markerIndex];
			if (active && markerIsAllowed(marker)) {
				marker.dot.show();
			} else {
				marker.Stop();
				marker.dot.hide();
			}
		}
	}
	document.querySelector('#map').addEventListener('wheel', function() {
		window.setTimeout(function() {
			applyScreenStableMarkerScale();
			hideLocationTooltip();
		}, 0);
	});

	document.querySelector("#countryHighlighting").addEventListener('change',(e) => {
		countryHighlighting=e.target.checked;
		if (!countryHighlighting) {
			if (popup2) {
				popup2.remove();
				popup2=null;
			}
			for (var country in WORLD) {
				if (WORLD[country].obj) {
					WORLD[country].obj.attr("fill", WORLD[country].obj.data("fill"));
				}
			}
		}
	});

	document.querySelector("#countryCities").addEventListener('change',(e) => {
		countryCities=e.target.checked;
		for (var country in WORLD) {
			if (WORLD[country].obj && WORLD[country].obj.capital) {
				if (countryCities) {
					WORLD[country].obj.capital.dot.show();
				} else {
					WORLD[country].obj.capital.dot.hide();
				}
			}
		}
	});

	document.querySelector("#companyApprovedOnly").addEventListener('change',(e) => {
		companyApprovedOnly=e.target.checked;
		updateProviderMarkers(aliSet, ali);
		updateProviderMarkers(awsSet, aws);
		updateProviderMarkers(azureSet, azure);
		updateProviderMarkers(gcpSet, gcp);
		updateProviderMarkers(ociSet, oci);
	});

	document.querySelector("#availabilityZones").addEventListener('change',(e) => {
		availabilityZonesVisible=e.target.checked;
		updateProviderMarkers(aliSet, ali);
		updateProviderMarkers(awsSet, aws);
		updateProviderMarkers(azureSet, azure);
		updateProviderMarkers(gcpSet, gcp);
		updateProviderMarkers(ociSet, oci);
	});

	document.querySelector("#dcMarkerSize").addEventListener('input',(e) => {
		markerRadius=Number(e.target.value);
		document.querySelector("#dcSizeValue").value=markerRadius+" px";
			var providerSets=[aliSet,awsSet,azureSet,gcpSet,ociSet];
			for (var setIndex=0; setIndex<providerSets.length; setIndex++) {
				for (var markerIndex=0; markerIndex<providerSets[setIndex].length; markerIndex++) {
					providerSets[setIndex][markerIndex].rad=markerRadius;
				}
			}
			applyScreenStableMarkerScale();
	});

	/*** Buttons to control which CSP locations to show ***/
	document.querySelector("#mapButtons #ali").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("aliSet: "+aliSet.length);
		ali=(ali==0)?1:0;
		updateProviderMarkers(aliSet, ali);
		if (ali) { bringProviderToFront(aliSet); }

		/*** Following two lines show how to change ***/
		//WORLD["CA"].obj.attr({"fill":"yellow"});
		//WORLD["CA"].obj.capital.Pulse();
	});
	document.querySelector("#mapButtons #aws").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("awsSet: "+awsSet.length);
		aws=(aws==0)?1:0;
		updateProviderMarkers(awsSet, aws);
		if (aws) { bringProviderToFront(awsSet); }
	});
	document.querySelector("#mapButtons #azure").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("azureSet: "+azureSet.length);
		azure=(azure==0)?1:0;
		updateProviderMarkers(azureSet, azure);
		if (azure) { bringProviderToFront(azureSet); }
	});
	document.querySelector("#mapButtons #gcp").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("gcpSet: "+gcpSet.length);
		gcp=(gcp==0)?1:0;
		updateProviderMarkers(gcpSet, gcp);
		if (gcp) { bringProviderToFront(gcpSet); }
	});
	document.querySelector("#mapButtons #oci").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
		oci=(oci==0)?1:0;
		updateProviderMarkers(ociSet, oci);
		if (oci) { bringProviderToFront(ociSet); }
	});

	/*** PanZoom controls ***/
	document.querySelector("#mapContainer #plus").addEventListener('click',(e) => {
		panZoom.zoomIn(1);
		applyScreenStableMarkerScale();
		hideLocationTooltip();
		e.preventDefault();
	});
	document.querySelector("#mapContainer #minus").addEventListener('click',(e) => {
		panZoom.zoomOut(1);
		applyScreenStableMarkerScale();
		hideLocationTooltip();
		e.preventDefault();
	});
	document.querySelector("#mapContainer #home").addEventListener('click',(e) => {
		panZoom.zoomOut( panZoom.getCurrentZoom() );
		var position = panZoom.getCurrentPosition();
		panZoom.pan(position.x - 120, position.y - 70);
		applyScreenStableMarkerScale();
		hideLocationTooltip();
		e.preventDefault();
	});
});
